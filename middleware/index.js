import DataLoader from 'dataloader';
import Spikenail from '../Spikenail';

// Koa2 middleware
export default function(options) {

  return async function(ctx, next) {
    let dataLoaders = {};

    // Create dataloaders
    for (let name of Object.keys(Spikenail.models)) {
      dataLoaders[name] = new DataLoader(async function(ids) {
        let result = await Spikenail.models[name].query({ query: {_id: { '$in': ids }} });
        return result.length ? result : [null];
      });
    }
    console.log('dataLoaders', dataLoaders);
    ctx.state.dataLoaders = dataLoaders;

    await next();
  }

}


