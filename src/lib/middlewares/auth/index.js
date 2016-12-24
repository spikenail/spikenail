import Spikenail from '../../Spikenail';

export default function(options) {
  return async function(ctx, next) {
    console.log('Koa auth middleware');

    // Try to extract viewer from header

    console.log('ctx headers', ctx.headers);

    if (!ctx.headers.authorization) {
      return await next();
    }

    let parts = ctx.headers.authorization.split(' ');
    if (parts.length === 2) {
      ctx.token = parts[1];
      console.log('token found', ctx.token);

      // request current user by token
      // TODO: user model is hardcoded as user, probably, make it configurable
      if (Spikenail.models.user) {
        ctx.currentUser = await Spikenail.models.user.model.findOne({"tokens.token": ctx.token});
      }
      console.log('currentUser found', ctx.currentUser);
    }

    await next();
  }
}


