import AuthService from '../../services/AuthService';

export default function(options) {
  return async function(ctx, next) {

    let token = null;

    // Try to extract token from query parameters
    if (ctx.request.query.auth_token) {
      token = ctx.request.query.auth_token;
    }

    // Try to extract viewer from header
    if (ctx.headers.authorization) {
      let parts = ctx.headers.authorization.split(' ');
      if (parts.length === 2) {
        token = parts[1];
      }
    }

    if (!token) {
      return await next();
    }

    ctx.token = token;

    let currentUser = await AuthService.authenticate(token);

    if (currentUser) {
      ctx.currentUser = currentUser;
    }

    await next();
  }
}


