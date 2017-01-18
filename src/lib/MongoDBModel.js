const debug = require('debug')('spikenail:MongoDBModel');

import Model from './Model';

import mongoose from 'mongoose';

import {
  fromGlobalId,
} from 'graphql-relay';

import connectionFromMongooseQuery from './components/RelayMongooseConnection';


/**
 * MongoDB Spikenail model
 */
export default class MongoDBModel extends Model {

  /**
   * @constructor
   */
  constructor(schema) {
    super(schema);
  }

  /**
   * @override
   */
  createAdapterModel(schema) {
    return this.createMongooseModel(schema);
  }

  /**
   * Creates mongoose model
   *
   * @param schema
   */
  createMongooseModel(schema) {

    debug('createMongooseModel, schema:', schema);

    let propsMap = {};
    for (let prop of Object.keys(schema.properties)) {

      let field = schema.properties[prop];

      // Skip id field
      if (prop == 'id') {
        continue;
      }

      // Skip virtual fields
      if (field.virtual) {
        continue;
      }

      // If relation
      if (field.relation) {
        // TODO: for now just skip relations
        // they are handled by graphql resolve
        // We need more complex logic here
        // e.g. we need to pick foreignKey from belongsTo relation
        // and convert [foreignKey] field to populated field

        //debug('relation field', field);
        //propsMap[prop] = this.getMongooseRelation(field);
        //debug('mongoose relation', propsMap[prop]);
        continue;
      }

      //if (typeof field === "function") {
      //  debug('relation field', field);
      //  field = field();
      //  propsMap[prop] = this.getMongooseRelation(field);
      //  debug('mongoose relation', propsMap[prop]);
      //  continue;
      //}

      // Plain field
      propsMap[prop] = this.fieldToMongooseType(field);
    }

    debug('mongoose props', propsMap);

    const mongooseSchema = mongoose.Schema(propsMap, schema.providerOptions);
    return mongoose.model(schema.name, mongooseSchema);
  }

  /**
   * Converts our model's type to mongoose type
   *
   * @param field
   */
  fieldToMongooseType(field) {
    if (field.type == 'id') {
      return mongoose.Schema.Types.ObjectId
    }

    if (field.type == 'Float') {
      return Number;
    }

    return field.type;
  }

  /**
   * Process create
   *
   * @param result
   * @param opts
   * @param input
   * @param ctx
   * @returns {{result: input}}
   */
  async processCreate(result, next, opts, input, ctx) {
    debug('processCreate', input);

    input.userId = ctx.currentUser._id;
    let item = await this.model.create(input);

    debug('processCreate item', item);

    result.result = item;

    next();
  }

  /**
   * Process update
   *
   * @param result
   * @param next
   * @param opts
   * @param input
   * @param ctx
   * @returns {{result: {id: *}}}
   */
  async processUpdate(result, next, opts, input, ctx) {
    debug('currentUser', ctx.currentUser);

    // Unpack document id from global id
    const id = fromGlobalId(input.id).id;
    delete input.id;

    // Update with no document returned. As we probably will request it later
    await this.model.findByIdAndUpdate(id, { $set: input }, { new: true });

    // TODO: we need to return id only if doc is actually updated (?)
    result.result = { id };

    next();
  }

  /**
   * Process remove
   *
   * @param chain
   * @param opts
   * @param input
   * @param ctx
   * @returns {{result: {id: *}}}
   */
  async processRemove(result, next, opts, input, ctx) {
    // TODO: support just hiding items
    //if (!input.id) {
    //  debug('no id specified');
    //  return {};
    //}

    const id = fromGlobalId(input.id).id;
    //let removeResult = await this.model.findOne({ id }).remove().exec();

    let removeResult = await this.model.findOneAndRemove({ _id: id });

    debug('removeResult', removeResult);

    // Return original id
    // FIXME: do not return id if nothing were removed
    result.result = { id: input.id };
  }

  /**
   * Convert property description to mongoose relation
   * @param field
   */
  getMongooseRelation(field) {
    // TODO: determine but not use hardcoded ObjectId
    let relation = { type: mongoose.Schema.Types.ObjectId, ref: field.ref };

    if (field.relation == 'hasMany') {
      return [relation];
    }

    return relation;
  }

  /**
   * Query
   *
   * @param options
   * @param _
   * @param args
   */
  async query(options = {}, _, args) {
    debug('query init', options);

    let query = this.argsToConditions(args);

    debug('argsToConditions result', query);

    if (options.query) {
      query = Object.assign(query, options.query);
    }

    let method = options.method ? options.method : 'find';

    let cursor = this.model[method](query);
    cursor.sort(this.argsToSort(args));

    //if (options.type == 'connection') {
    if (method == 'find') {
      debug('query, type - connection');
      cursor = connectionFromMongooseQuery(cursor, args);
    }

    let res = await cursor;

    debug('query result', res);
    return res;
  }

  /**
   * Converts args to conditions
   *
   * @param args
   */
  argsToConditions(args) {

    if (!args || !args.filter) {
      return {}
    }

    debug('argsToConditions', args);

    // Build filter.where
    if (args.filter.where) {
      return this.buildWhere(args.filter.where)
    }


    return {};
  }

  /**
   * Args to sort
   *
   * @param args
   */
  argsToSort(args) {
    debug('argsToSort', args);
    if (args && args.filter && args.filter.order) {
      return this.buildSort(args.filter.order);
    }

    return {};
  }

  /**
   * Builds mongodb where
   * TODO: move database specific functions to connectors
   *
   * @param where
   * @returns {{}}
   */
  buildWhere(where) {
    debug('buildWhere', where);

    try {

      var self = this;
      var query = {};
      if (where === null || (typeof where !== 'object')) {
        return query;
      }
      //var idName = self.idName(model);
      // TODO: make configurable
      let idName = 'id';

      Object.keys(where).forEach(function (k) {
        var cond = where[k];
        if (k === 'and' || k === 'or' || k === 'nor') {
          if (Array.isArray(cond)) {
            cond = cond.map(function (c) {
              return self.buildWhere(c);
            });
          }
          query['$' + k] = cond;
          delete query[k];
          return;
        }
        if (k === idName) {
          k = '_id';
        }
        var propName = k;
        if (k === '_id') {
          propName = idName;
        }
        //var prop = self.getPropertyDefinition(model, propName);

        var spec = false;
        var options = null;
        debug('cond', cond, cond.constructor);

        if (typeof cond === 'object') {
          // TODO: strange check that fails in my case
        //if (cond && cond.constructor.name === 'Object') {
          options = cond.options;
          spec = Object.keys(cond)[0];
          cond = cond[spec];
        }
        if (spec) {
          if (spec === 'between') {
            query[k] = {$gte: cond[0], $lte: cond[1]};
          } else if (spec === 'inq') {
            query[k] = {
              $in: cond.map(function (x) {
                if ('string' !== typeof x) return x;
                return ObjectID(x);
              }),
            };
          } else if (spec === 'nin') {
            query[k] = {
              $nin: cond.map(function (x) {
                if ('string' !== typeof x) return x;
                return ObjectID(x);
              }),
            };
          } else if (spec === 'like') {
            query[k] = {$regex: new RegExp(cond, options)};
          } else if (spec === 'nlike') {
            query[k] = {$not: new RegExp(cond, options)};
          } else if (spec === 'neq') {
            query[k] = {$ne: cond};
          } else if (spec === 'regexp') {
            if (cond.global)
              g.warn('{{MongoDB}} regex syntax does not respect the {{`g`}} flag');

            query[k] = {$regex: cond};
          } else {
            query[k] = {};
            query[k]['$' + spec] = cond;
          }
        } else {
          if (cond === null) {
            // http://docs.mongodb.org/manual/reference/operator/query/type/
            // Null: 10
            query[k] = {$type: 10};
          } else {
            query[k] = cond;
          }
        }
      });

    } catch (e) {
      console.error(e);
    }
    return query;
  };

  /**
   * Build mongodb sort
   * TODO: move database specific functions to connectors
   *
   * @param model
   * @param order
   * @returns {{}}
   */
  buildSort(order) {
    debug('buildSort', order);
    try {
      var sort = {};
      //var idName = this.idName(model);

      let idName = 'id';

      if (!order) {
        var idNames = ['id'];
        if (idNames && idNames.length) {
          order = idNames;
        }
      }
      if (order) {
        var keys = order;
        if (typeof keys === 'string') {
          keys = keys.split(',');
        }
        for (var index = 0, len = keys.length; index < len; index++) {
          var m = keys[index].match(/\s+(A|DE)SC$/);
          var key = keys[index];
          key = key.replace(/\s+(A|DE)SC$/, '').trim();
          if (key === idName) {
            key = '_id';
          }
          if (m && m[1] === 'DE') {
            sort[key] = -1;
          } else {
            sort[key] = 1;
          }
        }
      } else {
        // order by _id by default
        sort = {_id: 1};
      }
      return sort;
    } catch (e) {
      console.error(e);
    }
  };


  /**
   * Resolve single item
   *
   * @returns {{}}
   */
  async resolveItem(params, _, args, ctx) {
    debug('resolveItem', args);
    //return dataLoaders[this.getName()].load(new mongoose.Types.ObjectId(args.id));

    // Params.id
    return this.query({ query: { _id: new mongoose.Types.ObjectId(params.id || args.id) }, method: 'findOne' }, _, args);
  }

  /**
   * Resolve list
   *
   * @returns {Array}
   */
  async resolveList(params, _, args, ctx) {
    try {
      debug('resolveList', _, args);
      return this.query(params, _, args);
    } catch (err) {
      console.error('error', err);
    }
  }

  /**
   * Entry point to resolve
   * TODO: probably, make no sense
   */
  async resolve(params, _, args, ctx) {
    // If single item resolve
    if (params.type == 'single') {
      return this.resolveItem(params, _, args, ctx);
    }

    if (params.type == 'list') {
      return this.resolveList(params, _, args, ctx);
    }

    if (params.type == 'relation') {
      return this.resolveRelation(params, _, args, ctx)
    }
  }

  /**
   * Alias for single item resolve
   *
   * @param params
   * @param _
   * @param args
   * @param ctx
   * @returns {{}}
   */
  async resolveOne(params, _, args, ctx) {
    return this.resolveItem(params, _, args, ctx);
  }
}