import {
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { userPool, AUTH_ENABLED } from './cognitoConfig';

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export interface UserInfo {
  username: string;
  sub: string;
  groups: string[];
}

/**
 * Authenticate with Cognito using username and password.
 */
export function login(username: string, password: string): Promise<AuthTokens> {
  return new Promise((resolve, reject) => {
    if (!userPool) {
      return reject(new Error('Cognito not configured'));
    }

    const cognitoUser = new CognitoUser({
      Username: username,
      Pool: userPool,
    });

    const authDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess(session: CognitoUserSession) {
        resolve({
          accessToken: session.getAccessToken().getJwtToken(),
          idToken: session.getIdToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
        });
      },
      onFailure(err: Error) {
        reject(err);
      },
      newPasswordRequired(_userAttributes: Record<string, string>) {
        // First login with temp password - for now reject,
        // the admin should set a permanent password
        reject(new Error('NEW_PASSWORD_REQUIRED'));
      },
    });
  });
}

/**
 * Sign out the current user.
 */
export function logout(): void {
  if (!userPool) return;
  const user = userPool.getCurrentUser();
  if (user) {
    user.signOut();
  }
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns null if not authenticated.
 */
export function getAccessToken(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!AUTH_ENABLED || !userPool) {
      resolve(null);
      return;
    }

    const user = userPool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }

    user.getSession(
      (err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) {
          resolve(null);
          return;
        }

        // Check if token expires within 5 minutes
        const expiresAt = session.getAccessToken().getExpiration() * 1000;
        const fiveMinutes = 5 * 60 * 1000;

        if (Date.now() + fiveMinutes >= expiresAt) {
          // Token about to expire, refresh it
          const refreshToken = session.getRefreshToken();
          user.refreshSession(
            refreshToken,
            (refreshErr: Error | null, newSession: CognitoUserSession | null) => {
              if (refreshErr || !newSession) {
                resolve(null);
                return;
              }
              resolve(newSession.getAccessToken().getJwtToken());
            }
          );
        } else {
          resolve(session.getAccessToken().getJwtToken());
        }
      }
    );
  });
}

/**
 * Get current user info from the stored session.
 */
export function getCurrentUser(): Promise<UserInfo | null> {
  return new Promise((resolve) => {
    if (!AUTH_ENABLED || !userPool) {
      resolve(null);
      return;
    }

    const user = userPool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }

    user.getSession(
      (err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) {
          resolve(null);
          return;
        }

        const idPayload = session.getIdToken().decodePayload();
        resolve({
          username: idPayload['cognito:username'] || user.getUsername(),
          sub: idPayload.sub,
          groups: idPayload['cognito:groups'] || [],
        });
      }
    );
  });
}

/**
 * Returns Authorization headers for fetch calls.
 * In dev mode (no Cognito), returns empty object.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
