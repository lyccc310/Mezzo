import {
  CognitoUserPool,
} from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
};

export const userPool = poolData.UserPoolId
  ? new CognitoUserPool(poolData)
  : null;

export const COGNITO_REGION =
  import.meta.env.VITE_COGNITO_REGION || 'ap-northeast-1';

export const AUTH_ENABLED = !!(poolData.UserPoolId && poolData.ClientId);
