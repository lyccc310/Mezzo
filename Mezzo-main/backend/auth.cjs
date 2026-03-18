/**
 * Mezzo Authentication Module
 *
 * Verifies AWS Cognito JWT tokens for REST and WebSocket endpoints.
 * If COGNITO_USER_POOL_ID is not set, authentication is bypassed (dev mode).
 */

const logger = require('./logger.cjs');

const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const AUTH_ENABLED = !!(COGNITO_USER_POOL_ID && COGNITO_CLIENT_ID);

let verifier = null;

if (AUTH_ENABLED) {
  const { CognitoJwtVerifier } = require('aws-jwt-verify');
  verifier = CognitoJwtVerifier.create({
    userPoolId: COGNITO_USER_POOL_ID,
    tokenUse: 'access',
    clientId: COGNITO_CLIENT_ID,
  });
  logger.info('Cognito JWT authentication enabled', {
    userPoolId: COGNITO_USER_POOL_ID,
  });
} else {
  logger.warn('AUTH DISABLED: COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID not set');
}

/**
 * Extract user info from a verified JWT payload.
 */
function extractUser(payload) {
  return {
    sub: payload.sub,
    username: payload.username || payload['cognito:username'],
    groups: payload['cognito:groups'] || [],
  };
}

/**
 * Express middleware: require a valid JWT in the Authorization header.
 * In dev mode (no Cognito config), passes through with a stub user.
 */
async function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) {
    req.user = { sub: 'dev', username: 'dev-user', groups: ['admin'] };
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);
  try {
    const payload = await verifier.verify(token);
    req.user = extractUser(payload);
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Verify a JWT token for WebSocket connections.
 * Returns user object on success, null on failure.
 */
async function verifyWsToken(token) {
  if (!AUTH_ENABLED) {
    return { sub: 'dev', username: 'dev-user', groups: ['admin'] };
  }

  if (!token) return null;

  try {
    const payload = await verifier.verify(token);
    return extractUser(payload);
  } catch (err) {
    logger.warn('WS JWT verification failed', { error: err.message });
    return null;
  }
}

/**
 * Express middleware factory: require user to be in one of the specified roles.
 * Roles are matched against Cognito groups.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const userRole = req.user.groups[0] || 'officer';
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, verifyWsToken, requireRole, AUTH_ENABLED };
