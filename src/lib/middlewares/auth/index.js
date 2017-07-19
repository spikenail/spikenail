import Spikenail from '../../Spikenail';

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

    // request current user by token
    // TODO: user model is hardcoded as user, probably, make it configurable
    if (Spikenail.models.user) {
      ctx.currentUser = await Spikenail.models.user.model.findOne({"tokens.token": ctx.token});
    }

    await next();
  }
}


