import DataLoader from 'dataloader';
import Spikenail from '../../Spikenail';
const hl = require('debug')('hl');
const clone = require('lodash.clone');

// Koa2 middleware
export default function(options) {

  return async function(ctx, next) {
    let dataLoaders = {};

    // Create dataloaders
    for (let name of Object.keys(Spikenail.models)) {

      let model = Spikenail.models[name];

      dataLoaders[name] = new DataLoader(async function(ids) {
        let result = await Spikenail.models[name].query({ query: {_id: { '$in': ids }} });
        return result.length ? result : [null];
      });

      // Batch hasManyResolvers
      dataLoaders[name + 'HasManyLoader'] = new DataLoader(model.batchLoadHasMany.bind(model), { cache: false });
    }
    console.log('dataLoaders', dataLoaders);

    // TODO: what the purpose of the state?
    ctx.state.dataLoaders = dataLoaders;

    ctx.dataLoaders = dataLoaders;

    await next();
  }

}


