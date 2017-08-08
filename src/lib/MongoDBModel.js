const debug = require('debug')('spikenail:MongoDBModel');

import Model from './Model';

import mongoose from 'mongoose';

const hl = require('debug')('hl');
const hm = require('debug')('ro');
const ro = require('debug')('ro');

import ValidationService from './services/Validation/ValidationService';

import MongoAccessMap from './AccessMap/MongoAccessMap';

import {
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLID,
  GraphQLList
} from 'graphql';

import {
  connectionArgs,
  connectionDefinitions,
  connectionFromArray,
  cursorForObjectInConnection,
  fromGlobalId,
  globalIdField,
  mutationWithClientMutationId,
  nodeDefinitions,
  toGlobalId,
} from 'graphql-relay';

import GraphQLJSON from 'graphql-type-json';

import pluralize from 'pluralize';

const md5 = require('md5');

const sift = require('sift');

const path = require('path');

const clone = require('lodash.clone');
const isPlainObject = require('lodash.isplainobject');

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
   *
   * @private
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
      propsMap[prop] = { type: this.fieldToMongooseType(field) };

      if (field.default) {
        propsMap[prop].default = field.default;
      }
    }

    debug('mongoose props', propsMap);

    const mongooseSchema = mongoose.Schema(propsMap, schema.providerOptions);
    return mongoose.model(schema.name, mongooseSchema);
  }

  /**
   * Converts our model's type to mongoose type
   *
   * @param field
   *
   * @private
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
   * @param next
   * @param opts
   * @param input
   * @param ctx
   * @returns {Promise.<void>}
   */
  async processCreate(result, next, opts, input, ctx) {
    debug('processCreate', input);

    // Substitute current userId if not specified and if possible
    if (!input.userId && ctx.currentUser && ctx.currentUser._id && this.publicProperties.userId) {
      debug('need to substitute current userId');
      // It worth noting that editing of userId should be restricted - otherwise transfer will be possible
      // If necessary - on validation step we have to specify userId as not null

      // TODO: userId is a special property - it is currently hardcoded but might be configured somehow
      input.userId = ctx.currentUser._id;
    }

    let item = await this.model.create(this.extractInputKeys(input));

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
   * @param _
   * @param ctx
   * @returns {{result: {id: *}}}
   */
  async processUpdate(result, next, opts, _, ctx) {
    debug('processUpdate');
    debug('currentUser', ctx.currentUser);

    let data = this.extractInputKeys(_);
    let id = data.id;
    delete data.id;

    debug('data', data);
    debug('id', id);

    // Update with no document returned. As we probably will request it later
    await this.model.findByIdAndUpdate(id, { $set: data }, { new: true });

    // TODO: we need to return id only if doc is actually updated (?)
    result.result = { id };

    next();
  }

  /**
   * Process remove
   *
   * @param result
   * @param next
   * @param opts
   * @param input
   * @param ctx
   * @returns {Promise.<void>}
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
   *
   * @param field
   *
   * @private
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
    try {
      hm('query init', options);

      let query = this.argsToConditions(args);

      hm('argsToConditions result', query);

      if (options.query) {
        // Predefined query should have priority
        query = Object.assign(options.query, query);
      }

      let method = options.method ? options.method : 'find';
      hm('method', method);

      let cursor = this.model[method](query);
      cursor.sort(this.argsToSort(args));

      //if (options.type == 'connection') {
      if (method == 'find') {
        hm('query, type - connection', args);
        // something is broken here
        cursor = connectionFromMongooseQuery(cursor, args);
      }

      hm('await cursor');

      let res = await cursor;

      hm('query result %o', res);

      return res;
    } catch(e) {
      console.error(e);
      throw e;
    }
  }

  /**
   * Converts args to conditions
   *
   * @param args
   *
   * @private
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
   *
   * @private
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
   *
   * @param where
   * @returns {{}}
   */
  buildWhere(where) {
    debug('buildWhere', where);
    try {
      let self = this;
      let query = {};
      if (where === null || (typeof where !== 'object')) {
        return query;
      }

      // TODO: make configurable
      let idName = 'id';

      Object.keys(where).forEach(function (k) {
        let cond = where[k];
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
        let propName = k;
        if (k === '_id') {
          propName = idName;
        }
        //var prop = self.getPropertyDefinition(model, propName);

        let spec = false;
        let options = null;
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
                return new mongoose.Types.ObjectId(x);
              }),
            };
          } else if (spec === 'nin') {
            query[k] = {
              $nin: cond.map(function (x) {
                if ('string' !== typeof x) return x;
                return new mongoose.Types.ObjectId(x);
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
   *
   * @param order
   * @returns {{}}
   */
  buildSort(order) {
    debug('buildSort', order);
    try {
      let sort = {};
      //var idName = this.idName(model);

      // TODO: should be configurable?
      let idName = 'id';

      if (!order) {
        let idNames = ['id'];
        if (idNames && idNames.length) {
          order = idNames;
        }
      }
      if (order) {
        let keys = order;
        if (typeof keys === 'string') {
          keys = keys.split(',');
        }
        for (let index = 0, len = keys.length; index < len; index++) {
          let m = keys[index].match(/\s+(A|DE)SC$/);
          let key = keys[index];
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
   * Create ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param ctx
   * @returns {Promise.<void>}
   */
  async handleCreateACL(result, next, options, _, ctx) {
    // Create access map for current model, specifying only props that we trying to save
    let accessMap = new MongoAccessMap(this, ctx, { action: options.action, properties: Object.keys(_) });
    await accessMap.init();

    debug('%s: handleCreateACL: %o', this.getName(), accessMap.accessMap);

    ctx.accessMap = accessMap;

    // If access map has at least one strict false value we throw 403 error
    // We can't just trim this value and save all other, as it might lead to misunderstanding
    if (accessMap.hasAtLeastOneFalseValue()) {
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    let input = this.extractInputKeys(_);

    if (accessMap.isUnresolved()) {
      await accessMap.handleDependencies({}, {
        [this.getName()]: [input]
      });

      accessMap.buildRuleSetQueries();

      // Check one more time - as applying dependent data might produce false values
      if (accessMap.hasAtLeastOneFalseValue()) {
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }
    }

    hl('%s: handleCreateACL - final access map: %o', this.getName(), accessMap.accessMap);

    // Check for all true values
    if (accessMap.isPassing()) {
      debug(this.getName(), 'create ACL, access map is passing');
      return next();
    }

    // If not passing and does not have at least one false value - try to build query
    let query = await accessMap.getQuery();

    // Apply query on input data to check
    let siftResult = sift(query, [input]);
    if (!siftResult.length) {
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    next();
  }

  /**
   * Handle update ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param ctx
   * @returns {Promise.<void>}
   */
  async handleUpdateACL(result, next, options, _, ctx) {
    let accessMap = new MongoAccessMap(this, ctx, { action: options.action, properties: Object.keys(_) });
    await accessMap.init();

    ctx.accessMap = accessMap;

    // If access map has at least one strict false value we throw 403 error
    // We can't just trim this value and save all other, as it might lead to misunderstanding
    if (accessMap.hasAtLeastOneFalseValue()) {
      debug('access map has at least one false');
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    if (accessMap.isPassing()) {
      debug('access map is passing');
      return next();
    }

    let id = fromGlobalId(_.id).id;
    let input = this.extractInputKeys(_);

    // We need fetch the document anyway
    // TODO: we need to cache this with data loader in order to avoid race-condition issues
    // TODO: and not to fetch same doc twice
    let doc = await this.query.bind(this, {
      method: 'findOne',
      query: { _id: new mongoose.Types.ObjectId(id) }
    }, _, {})();

    if (!doc) {
      debug('no document found');
      //TODO: should we have explicit difference between not found and 403?
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];
      return;
    }

    if (accessMap.hasDependentRules() && accessMap.isUnresolved()) {
      await accessMap.handleDependencies({}, {
        [this.getName()]: [doc]
      });

      // Check one more time - as applying dependent data might produce false values
      if (accessMap.hasAtLeastOneFalseValue()) {
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }

      if (accessMap.isPassing()) {
        return next();
      }
    }

    let query = await accessMap.getQuery();
    let siftResult = sift(query, [doc]);
    if (!siftResult.length) {
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    // In some cases we have to do and additional ACL check
    // It is needed if we are changing foreign keys
    // TODO: check that we even changing relations affected by dependent rules
    if (accessMap.initialProps.hasDependentRules) {
      // Create access map only for dependent rules
      // check one more time
      let accessMap = new MongoAccessMap(this, ctx, {
        action: options.action,
        properties: Object.keys(_),
        onlyDependentRules: true
      });
      await accessMap.init();

      let newDoc = Object.assign({}, doc.toObject(), input);

      // TODO: cache something - double dependencies handling
      await accessMap.handleDependencies({}, {
        [this.getName()]: [newDoc]
      });

      if (accessMap.hasAtLeastOneFalseValue()) {
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }

      if (accessMap.isPassing()) {
        return next();
      }

      let query = await accessMap.getQuery();
      let siftResult = sift(query, [newDoc]);

      if (!siftResult.length) {
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }
    }

    next();
  }

  /**
   * Handle remove ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param ctx
   * @returns {Promise.<*>}
   */
  async handleRemoveACL(result, next, options, _, ctx) {
    let accessMap = new MongoAccessMap(this, ctx, { action: options.action, properties: Object.keys(_) });
    await accessMap.init();

    // If access map has at least one strict false value we throw 403 error
    // We can't just trim this value and save all other, as it might lead to misunderstanding
    if (accessMap.hasAtLeastOneTrueValue()) {
      return next();
    }

    if (accessMap.isFails()) {
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }


    // TODO: almost copypaste of update ACL

    let id = fromGlobalId(_.id).id;
    let input = this.extractInputKeys(_);

    // We need fetch the document anyway
    // TODO: we need to cache this with data loader in order to avoid race-condition issues
    // TODO: and not to fetch same doc twice
    let doc = await this.query.bind(this, {
      method: 'findOne',
      query: { _id: new mongoose.Types.ObjectId(id) }
    }, _, {})();

    if (!doc) {
      //TODO: should we have explicit difference between not found and 403?
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];
      return;
    }

    if (accessMap.hasDependentRules() && accessMap.isUnresolved()) {
      await accessMap.handleDependencies({}, {
        [this.getName()]: [doc]
      });

      if (accessMap.hasAtLeastOneTrueValue()) {
        return next();
      }

      if (accessMap.isFails()) {
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }
    }

    let query = await accessMap.getQuery();
    let siftResult = sift(query, [doc]);

    if (!siftResult.length) {
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    next();
  }

  /**
   * TODO: almost copypaste for now
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async handleReadOneACL(result, next, options, _, args, ctx) {

    debug('%s: handle read one ACL', this.getName());

    let accessMap = new MongoAccessMap(this, ctx, { action: 'read' });
    await accessMap.init();

    // Store access map in the context
    // TODO: here we are probably overriding previous accessMap of parent items.
    // TODO: any potential issue? It is still the same context I guess
    ctx.accessMap = accessMap;

    if (accessMap.isFails()) {
      debug('%s: readOne ACL, access map fails', this.getName());
      result.result = null;
      return;
    }

    next();
  }

  /**
   * Handle hasMany ACL
   * TODO: it is almost full copy from handleReadALLACL for now. Need to do refactoring
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async handleHasManyACL(result, next, options, _, args, ctx) {

    ro('%s: handle has many ACL', this.getName());
    hm('%s: parent data: %j', this.getName(), _);

    ro('%s: hasMany ACL, options: %o', this.getName(), options);
    ro('%s: hasMany ACL, args: %o', this.getName(), args);

    let accessMap = new MongoAccessMap(this, ctx, { action: 'read' }, _);
    await accessMap.init();

    // Store access map in the context
    if (!ctx.accessMaps) {
      ctx.accessMaps = {};
    }
    ctx.accessMaps[this.getName()] = accessMap;

    if (accessMap.isFails()) {
      ro('%s: accessMap fails from the beginning', this.getName());
      // TODO: all this formatting stuff should not be here
      result.result = {
        edges: null
      };
      return;
    }

    // We don't need to apply query if we unable to skip whole documents
    // In this case we will handle deps later if needed
    if (accessMap.hasAtLeastOneTrueValue()) {
      ro('%s: access map has true values, no need to apply query. Next', this.getName());
      return next();
    }

    // before building query handle deps if needed
    await accessMap.handleDependencies({
      [options.parentModelName]: _
    });

    // Try to build query as we possibly need it
    let query = await accessMap.getQuery();

    // FIXME: If below is possible that something probably went wrong!
    if (!query) {
      ro('%s: no query is generated', this.getName());
      return next();
    }

    ro('%s: apply query: %o', this.getName(), query);

    // Apply query
    options.query = Object.assign(options.query || {}, query);

    next();
  }

  /**
   * Handle read all ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @private
   */
  async handleReadAllACL(result, next, options, _, args, ctx) {
    debug('%s: handle readAll ACL', this.getName());

    // TODO: pass requested (+dependent) fields in options
    let accessMap = new MongoAccessMap(this, ctx, { action: 'read' });
    await accessMap.init();

    // Store access map in the context
    if (!ctx.accessMaps) {
      ctx.accessMaps = {};
    }
    ctx.accessMaps[this.getName()] = accessMap;

    if (accessMap.isFails()) {
      debug('%s: accessMap fails from the beginning', this.getName());
      result.result = {
        edges: null
      };
      return;
    }

    // We don't need to apply query if we unable to skip whole documents
    // In this case we will handle deps later if needed
    if (accessMap.hasAtLeastOneTrueValue()) {
      debug('%s: access map has true values, no need to apply query. Next', this.getName());
      return next();
    }

    // before building query handle deps if needed
    await accessMap.handleDependencies();

    // Try to build query as we possibly need it
    let query = await accessMap.getQuery();

    // FIXME: If below is possible that something probably went wrong!
    if (!query) {
      debug('%s: no query is generated', this.getName());
      return next();
    }

    debug('%s: apply query: %o', this.getName(), query);

    // Apply query
    options.query = Object.assign(options.query || {}, query);

    next();
  }

  /**
   * Apply access map to data
   * TODO: use this method in postHandleReadAllACL
   *
   * @param accessMap calculated accessMap
   * @param data
   */
  applyAccessMapToData(accessMap, data) {
    debug('%s: apply accessMap to data %j', this.getName(), data);

    return data.map(sourceDoc => {
      let doc = clone(sourceDoc);

      // Cache query results
      let testedQueries = {};
      for (let prop of Object.keys(accessMap.accessMap)) {
        let val = accessMap.accessMap[prop];

        let allow;

        if (typeof(val) ==='boolean') {
          allow = val;
        } else {
          let query = val.query;
          // Apply query on object
          // TODO: we don't need md5
          let queryId = md5(JSON.stringify(query));
          // Check for cached result
          if (testedQueries[queryId] !== undefined) {
            allow = testedQueries[queryId];
          } else {
            // Apply query
            // TODO: probably, we should put data formatting in the last middleware
            // TODO: and not access node here
            let queryResult = sift(query, [doc]);

            if (queryResult.length) {
              allow = true;
            } else {
              allow = false;
            }
            testedQueries[queryId] = allow;
          }
        }

        if (!allow) {
          // FIXME: quick workaround
          if (prop == 'id') {
            doc['_id'] = null;
            continue;
          }

          // TODO: should we actually remove property completely with delete
          // TODO: we currently operate with mongoose objects
          // TODO: should we ever convert it to plain objects
          doc[prop] = null;
        }
      }

      debug(this.getName(), 'doc with applied accessMap', doc);

      // check if doc is all null values document - return null then
      let isAllNull = true;
      let plainNode = doc.toObject();
      for (let key of Object.keys(plainNode)) {
        if (accessMap.accessMap[key] === undefined) {
          continue;
        }

        if (plainNode[key] !== null) {
          isAllNull = false;
          break;
        }
      }

      if (isAllNull) {
        debug(this.getName(), 'all null');
        return null;
      }

      return doc;
    }).filter(doc => {
      // remove null docs
      return doc !== null
    });
  }

  /**
   * Post handle read one ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async postHandleReadOneACL(result, next, options, _, args, ctx) {
    try {
      debug('%s postHandleReadOneACL %o', this.getName(), ctx.accessMap.accessMap);

      debug('result', result);

      // Skip if no access map defined
      if (!ctx.accessMap) {
        return next();
      }

      // Skip for empty result
      if (!result || !result.result) {
        debug('%s no readOne result %o', this.getName());
        return next();
      }

      // Handle dependencies if needed
      // FIXME: will always be unresolved even it does not have dependencies
      if (ctx.accessMap.isUnresolved()) {
        debug('%s: accessMap is unresolved - handle deps', this.getName());
        await ctx.accessMap.handleDependencies({}, {[this.getName()]: [result.result]});
      }

      ctx.accessMap.buildRuleSetQueries();

      // TODO: We need to put data formatting at last step
      let data = [result.result];

      // FIXME: always applies, but should not in some cases
      let resultData = this.applyAccessMapToData(ctx.accessMap, data);

      debug('%s resultData %o', this.getName(), resultData);

      result.result = resultData[0] || null;

      // FIXME: it is fast workaround - see readAll postACL to perform correct check
      if (result.result && result.result._id === null) {
        result.result = null;
      }

      next();
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  /**
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   */
  async postHandleReadAllACL(result, next, options, _, args, ctx) {
    hm('%s post handle readAll ACL', this.getName());

    let accessMap = ctx.accessMaps ? ctx.accessMaps[this.getName()] : null;

    // Skip if no access map defined
    if (accessMap) {
      hm('%s post handle readAll ACL - no access map skip', this.getName());
      return next();
    }

    // Skip for empty result
    if (!result.result || !result.result.edges || !result.result.edges.length) {
      hm('%s: empty result - skip', this.getName());
      return next();
    }

    // Skip for plain access map with no queries - nothing to do
    if (accessMap.isPlain()) {
      // FIXME: why we should not apply it. Still different values for different fields
      debug('%s access map is plain skip', this.getName());
      return next();
    }

    // Skip for access map with one query covering all values
    // In this case no individual values filtering needed
    // TODO


    // TODO: this is workaround - we should put data formatting in last step
    // Let's change result.result format to simple array
    let data = result.result.edges.map(edge => {
      return edge.node;
    });

    // Handle dependencies if needed
    if (accessMap.isUnresolved()) {
      // FIXME: for some reason access map of list is unresolved - it should not be!
      debug('%s: accessMap is unresolved - handle deps', this.getName());

      await accessMap.handleDependencies({ [this.getName()]: data });
    }

    let filteredData = this.applyAccessMapToData(accessMap, data);

    debug('filteredData', filteredData);

    // Apply formatting
    // TODO: it is workaround
    result.result.edges = filteredData.map(item => {
      return {
        node: item
      }
    });

    next();
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
   * Entrypoint for resolving hasMany
   *
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<{}>}
   */
  async resolveHasMany(options, _, args, ctx) {

    if (!Array.isArray(_)) {
      _ = [_];
    }

    let ids = _.map(item => item._id);

    debug(this.getName(), 'resolveHasMany ids', ids);

    // Specifying additional condition
    options.query = {
      //[options.property.foreignKey]: _._id
      [options.property.foreignKey]: { '$in': ids }
    };

    options.actionType = 'hasMany';

    debug(this.getName(), 'resolveHasMany options', options);

    return (await this.processChain(this.getReadChain(), ...arguments)).result;
  }

  /**
   * Entrypoint for resolving belongsTo relation
   *
   * @param options
   * @param _
   * @param args
   * @param ctx
   */
  async resolveBelongsTo(options, _, args, ctx) {

    ro('resolve belongsTo');

    if (!Array.isArray(_)) {
      _ = [_];
    }

    let ids = _.map(item => item[options.property.foreignKey]);

    // TODO: Should we remove duplicates?

    options.query = {
      //[options.property.foreignKey]: _._id
      _id: { '$in': ids }
    };

    // TODO: Let's use hasMany chain here for now
    // We need to do refactoring later
    // The only difference between "all" and "hasMany" is that hasMany is taking in account parent items fetched
    options.actionType = 'hasMany';
    return (await this.processChain(this.getReadChain(), ...arguments)).result;
  }

  /**
   * Process read
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async processRead(result, next, options, _, args, ctx) {
    hm('%s: processRead', this.getName());
    // TODO: lets handle it here for now:
    if (options.actionType === 'one') {
      options.method = 'findOne';

      if (!options.query) {
        options.query = {};
      }
      // TODO: don't actually remember why we have to select options.id or args.id
      Object.assign(options.query, { _id: new mongoose.Types.ObjectId(options.id || args.id) });
    }

    hm('%s: before query', this.getName());
    result.result = await this.query.bind(this, options, _, args)();
    hm('%s: query result: %o', this.getName(), result.result);
    next();
  }
}