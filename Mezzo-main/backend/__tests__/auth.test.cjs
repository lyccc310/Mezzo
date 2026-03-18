/**
 * Tests for backend/auth.cjs
 *
 * Since we cannot actually call AWS Cognito in tests,
 * we test the module behavior with and without env vars set.
 */

// Save original env
const originalEnv = { ...process.env };

afterEach(() => {
  // Restore env
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe('auth.cjs', () => {
  describe('when COGNITO_USER_POOL_ID is NOT set (dev mode)', () => {
    let auth;

    beforeEach(() => {
      delete process.env.COGNITO_USER_POOL_ID;
      delete process.env.COGNITO_CLIENT_ID;
      auth = require('../auth.cjs');
    });

    test('AUTH_ENABLED is false', () => {
      expect(auth.AUTH_ENABLED).toBe(false);
    });

    test('requireAuth passes through with dev user', async () => {
      const req = { headers: {} };
      const res = {};
      const next = jest.fn();

      await auth.requireAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.username).toBe('dev-user');
      expect(req.user.groups).toContain('admin');
    });

    test('verifyWsToken returns dev user without token', async () => {
      const user = await auth.verifyWsToken(null);
      expect(user).toBeDefined();
      expect(user.username).toBe('dev-user');
    });

    test('verifyWsToken returns dev user with any token', async () => {
      const user = await auth.verifyWsToken('fake-token');
      expect(user).toBeDefined();
      expect(user.username).toBe('dev-user');
    });

    test('requireRole passes for dev user (admin)', async () => {
      const req = { user: { sub: 'dev', username: 'dev-user', groups: ['admin'] } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = auth.requireRole('admin');
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('requireRole rejects user without matching role', () => {
      const req = { user: { sub: 'dev', username: 'dev-user', groups: ['officer'] } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = auth.requireRole('admin');
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('requireRole rejects unauthenticated user', () => {
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      const middleware = auth.requireRole('admin');
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('when COGNITO vars are set but no actual Cognito', () => {
    let auth;

    beforeEach(() => {
      process.env.COGNITO_USER_POOL_ID = 'ap-northeast-1_TESTPOOL';
      process.env.COGNITO_CLIENT_ID = 'test-client-id';
      // This will create a verifier but it won't be able to verify tokens
      // since JWKS endpoint is not available
      auth = require('../auth.cjs');
    });

    test('AUTH_ENABLED is true', () => {
      expect(auth.AUTH_ENABLED).toBe(true);
    });

    test('requireAuth rejects request without Authorization header', async () => {
      const req = { headers: {} };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await auth.requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    test('requireAuth rejects request with invalid Bearer token', async () => {
      const req = { headers: { authorization: 'Bearer invalid-jwt-token' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await auth.requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('requireAuth rejects non-Bearer auth header', async () => {
      const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await auth.requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('verifyWsToken returns null for empty token', async () => {
      const user = await auth.verifyWsToken(null);
      expect(user).toBeNull();
    });

    test('verifyWsToken returns null for invalid token', async () => {
      const user = await auth.verifyWsToken('invalid-jwt');
      expect(user).toBeNull();
    });
  });
});
