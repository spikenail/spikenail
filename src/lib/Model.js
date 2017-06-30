const debug = require('debug')('spikenail:Model');
const hl = require('debug')('hl');
const hm = require('debug')('hm');
const ro = require('debug')('ro');

const clone = require('lodash.clone');
const isPlainObject = require('lodash.isplainobject');

import pluralize from 'pluralize';

const md5 = require('md5');

const sift = require('sift');

const path = require('path');

import mongoose from 'mongoose';

import Spikenail from './Spikenail';

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

/**
 * Abstract Spikenail Model
 */
export default class Model {

  /**
   * @constructor
   */
  constructor(schema) {
    try {
      debug(schema.name, 'constructor');

      this.schema = schema;

      if (!this.schema.name) {
        schema.name = this.constructor.name.toLowerCase();
      }

      this.name = schema.name;

      // For now, we are supporting only mongodb
      if (!schema.properties) {
        debug('Warning - no schema properties');
        return;
      }

      this.initializeProperties();
      this.initializeACLs();

      // lets create 2 properties
      this.properties = schema.properties;
      this.publicProperties = {};
      this.schema.publicProperties = this.publicProperties;

      Object.keys(this.properties).forEach(prop => {
        if (this.properties[prop].private) {
          return;
        }

        this.publicProperties[prop] = this.properties[prop];
      });

      // Expose model
      this.model = this.createAdapterModel(schema);
    } catch(err) {
      console.error('error', err);
    }
  }

  /**
   * Creates model instance of underlying database provider
   * @param schema
   */
  createAdapterModel(schema) {}

  /**
   * Get name
   *
   * @returns {string}
   */
  getName() {
    return this.name;
  }

  /**
   * Is viewer
   * @returns {boolean}
   */
  isViewer() {
    return !!this.schema.isViewer
  }

  /**
   * Creates mongoose model
   *
   * @param schema
   */
  createMongooseModel(schema) {

    debug(this.getName(), 'creating mongoose model');

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

    const mongooseSchema = mongoose.Schema(propsMap);
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

    return field.type;
  }

  /**
   *
   */
  getMutationArgs() {
    return {
      input: {
        name: 'input',
        type: GraphQLInputObjectType
      }
    }
  }

  /**
   * Before create
   *
   * @param result
   * @param next
   * @param opts
   * @param input
   * @param ctx
   */
  async beforeCreate(result, next, opts, input, ctx) {
    next();
  }

  /**
   * After create
   */
  async afterCreate() {}

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
    next();
  }

  /**
   * Before update
   *
   * @param result
   * @param next
   */
  beforeUpdate(result, next) {
    next();
  }

  /**
   * After update
   */
  afterUpdate() {}

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
    next();
  }

  /**
   * Before remove
   *
   * @param result
   * @param next
   */
  beforeRemove(result, next) {
    next();
  }

  /**
   * After remove
   */
  afterRemove() {

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
    next();
  }

  /**
   * Validation of input data
   *
   * @param result
   * @param next
   * @param opts
   * @param input
   * @param ctx
   */
  async validate(result, next, opts, input, ctx) {
    debug(this.getName(), 'validating input:', input);
    if (!this.schema.validations || !this.schema.validations.length) {
      debug(this.getName(), 'no validation defined');
      return next();
    }

    // TODO filter validations by action

    let errors = await ValidationService.validate(input, this.schema.validations);

    if (errors.length) {
      result.errors = errors;
      return;
    }

    next();
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
   * Input data will have global id but we can only work internally with database id
   */
  extractInputKeys(data) {
    let input = clone(data);

    for (let key of Object.keys(input)) {
      let prop = this.publicProperties[key];

      // typeof check is added in order to avoid attempts to convert already substituted ObjectId like userId
      // TODO: but it looks like kind of workaround
      if (prop && prop.type == 'id' && typeof input[key] === 'string') {
        input[key] = fromGlobalId(input[key]).id;
      }
    }

    return input;
  }

  /**
   * Set ACL defaults etc
   * TODO: add validations
   */
  initializeACLs() {

    if (!this.schema.acls) {
      return;
    }

    for (let rule of this.schema.acls) {
      if (!rule.properties) {
        rule.properties = ['*'];
      } else {
        if (!Array.isArray(rule.properties)) {
          rule.properties = [rule.properties];
        }
        // TODO: if * exists remove all other properties
      }

      if (!rule.roles) {
        rule.roles = ['*'];
      } else {
        if (!Array.isArray(rule.roles)) {
          rule.roles = [rule.roles];
        }
        // TODO: if * exists remove all other roles
      }

      if (!rule.actions) {
        rule.actions = ['*']
      } else {
        if (!Array.isArray(rule.actions)) {
          rule.actions = [rule.actions];
        }
        // TODO: if * exists remove all other actions
      }

      if (rule.scope && typeof rule.scope !== 'function') {
        // TODO: is it good way to go?
        let scope = clone(rule.scope);
        rule.scope = function() {
          return scope;
        }
      }

      if (rule.checkRelation && rule.checkRelation.scope && rule.checkRelation.scope !== 'function') {
        let scope = clone(rule.checkRelation.scope);
        rule.checkRelation.scope = function() {
          return scope;
        }
      }
    }
  }

  /**
   * Set properties defaults. Convert to usable form
   *
   *  TODO: throw warnings and errors for properties defined incorrectly
   */
  initializeProperties() {
    let possibleRelations = ['belongsTo', 'hasMany'];

    if (!this.schema.properties) {
      return;
    }

    Object.keys(this.schema.properties).forEach(key => {
      let prop = this.schema.properties[key];

      // Initialize foreignKeyFor
      if (prop.type === 'id' && key !== 'id' && !prop.foreignKeyFor) {
        // For ids that are not primary keys set foreignKeyFor
        prop.foreignKeyFor = key.replace(/Id$/, '');
      }

      // Extract relations
      if (prop.relation) {
        if (!~possibleRelations.indexOf(prop.relation)) {
          throw new Error(`Relation "${prop.relation}" is not exists`);
        }

        // Set defaults for ref
        if (!prop.ref) {
          if (prop.relation === "belongsTo") {
            prop.ref = key;
          }

          if (prop.relation === "hasMany") {
            // singularize, e.g. has many lists, ref to model list
            prop.ref = pluralize.singular(key);
          }
        }

        if (!prop.foreignKey) {
          if (prop.relation === "belongsTo") {
            prop.foreignKey = key + 'Id';
          }

          if (prop.relation === "hasMany") {
            prop.foreignKey = this.getName() + 'Id';
          }
        }

        debug('Prop with defaults', prop);
      }
    });

  }

  /**
   * Handles READ acl and applies scope conditions if needed
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async handleReadACL(result, next, options, _, args, ctx) {
    debug(this.getName(), 'handle read acl');
    // Handles ACL
    if (!this.schema.acls || !this.schema.acls.length) {
      debug('no acls defined');
      return next();
    }

    if (options.actionType == 'all') {
      return await this.handleReadAllACL(...arguments);
    }

    if (options.actionType == 'hasMany') {
      return await this.handleHasManyACL(...arguments);
    }

    if (options.actionType == 'one') {
      return await this.handleReadOneACL(...arguments);
    }

    if (options.actionType == 'belongsTo') {
      // TODO
    }

    next();
  }

  /**
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<*>}
   */
  async postHandleReadACL(result, next, options, _, args, ctx) {
    debug(this.getName(), 'post handle read ACL');

    // Handles ACL
    if (!this.schema.acls || !this.schema.acls.length) {
      debug(this.getName(), 'no acls defined');
      return next();
    }

    if (options.actionType == 'all') {
      return await this.postHandleReadAllACL(...arguments);
    }

    if (options.actionType == 'hasMany') {
      // TODO: same function?
      return await this.postHandleReadAllACL(...arguments);
    }

    if (options.actionType == 'one') {
      return await this.postHandleReadOneACL(...arguments);
    }

  }

  /**
   * Returns default ACL rules
   *
   * @returns {*}
   */
  getACLs() {
    return this.schema.acls || [];
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
   *
   * @deprecated
   *
   * @param accessMap
   * @param data current data
   */
  async fetchDataForDependentRules(accessMap, sourceData) {
    debug(this.getName(), 'fetching data for dependent rules');

    let data = sourceData;
    if (!Array.isArray(sourceData)) {
      data = [sourceData];
    }

    let dependentRules = accessMap.getDependentRules();

    // Dependent models map initialization
    let modelsMap = {};
    for (let rule of dependentRules) {
      let model = accessMap.getDependentModel(rule);
      let modelName = model.getName();

      // Initialize
      if (modelsMap[modelName]) {
        continue;
      }

      modelsMap[modelName] = {
        model: model,
        foreignKey: this.publicProperties[modelName].foreignKey,
        ids: new Set()
      }
    }

    // Fill ids array of modelsMap
    for (let doc of data) {
      for (let val of Object.values(modelsMap)) {
        if (doc[val.foreignKey]) {
          val.ids.add(doc[val.foreignKey]);
        }
      }
    }

    // Then iterate map perform queries
    // TODO: we need only limited fields to be fetched
    // TODO: use Promise.all
    for (let val of Object.values(modelsMap)) {
      // TODO: handle not found case
      val.data = await val.model.model.find({ _id: { '$in': Array.from(val.ids) } });
      debug(this.getName(), 'fetched data', val.data);
    }

    return modelsMap;
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
   * To hash
   * @param data
   */
  toHash(data) {
    return md5(JSON.stringify(data));
  }

  /**
   * Returns roles that don't depends on anything but user
   * Anonymous, User, roles taken directly from the database for particular user
   * Override this method to add custom logic
   * Function should be synchronous. Current user and its static roles should be fetched once.
   *
   * @param ctx
   * @returns {[string]}
   */
  getStaticRoles(ctx) {
    let currentUser = this.getCurrentUserFromContext(ctx);
    if (!currentUser) {
      return ['anonymous'];
    }

    return ['user'];
  }

  /**
   * Get dynamic roles
   */
  getDynamicRoles(ctx) {
    // Owner is predefined custom role
    // TODO: predefine or init step. Otherwise, roles should be accessed only through this method
    let roles = {
      owner: {
        cond: function(ctx) {
          if (!ctx.currentUser) {
            return false;
          }

          return { userId: ctx.currentUser._id }
        }
      }
    };

    return Object.assign(roles, this.schema.roles || {} );
  }

  /**
   * Some dynamic roles might act as static roles
   *
   * TODO: incorrect method name - we are not calculated everything
   *
   * @param ctx
   */
  calculateDynamicRoles(ctx) {
    let dynamicRoles = this.getDynamicRoles(ctx);

    if (!dynamicRoles) {
      return {};
    }

    let roles = {};
    Object.keys(dynamicRoles).forEach(roleName => {

      let calculatedCond = dynamicRoles[roleName].cond(ctx);
      if (typeof calculatedCond === 'boolean') {
        roles[roleName] = calculatedCond;
        return;
      }

      roles[roleName] = dynamicRoles[roleName];
    });

    return roles;
  }

  /**
   * Return non false dynamic roles
   *
   * @param ctx
   */
  getPossibleDynamicRoles(ctx) {
    let roles = this.calculateDynamicRoles(ctx);

    let result = {};
    Object.keys(roles).forEach(roleName => {
      if (!roles[roleName]) {
        return;
      }

      result[roleName] = roles[roleName];
    });

    return result;
  }

  /**
   *
   * @param ctx
   * @returns {Array}
   */
  getPossibleDynamicRoleNames(ctx) {
    return Object.keys(this.getPossibleDynamicRoles(ctx));
  }

  /**
   * Get non boolean calculated dynamic roles
   *
   * @param ctx
   */
  getRealDynamicRoles(ctx) {
    let roles = this.calculateDynamicRoles(ctx);

    let result = {};
    Object.keys(roles).forEach(roleName => {
      if (typeof roles[roleName] === "boolean") {
        return;
      }

      result[roleName] = roles[roleName];
    });

    return result;
  }

  /**
   * Get dynamic role names
   * @returns {Array}
   */
  getDynamicRoleNames(ctx) {
    return Object.keys(this.getDynamicRoles(ctx));
  }

  /**
   * Get all roles that we possibly need to check
   *
   * @param acls
   */
  getPossibleRoles(acls) {
    let roles = [];
    acls.forEach(rule => {
      roles = [...roles, ...rule.roles];
    });

    return [...new Set(roles)];
  }

  /**
   *
   * @param currentUser
   * @param opts
   * @param input
   * @param ctx
   */
  getNewItemRoles(currentUser, opts, input, ctx) {
  }

  /**
   * Extracts ownerId from item
   *
   * @param item
   */
  getItemOwnerId(item) {
    return item.userId;
  }


  /**
   * Get current user from context
   */
  getCurrentUserFromContext(ctx) {
    return ctx.currentUser;
  }

  /**
   * Compiles ACL to the list of fields available for given action
   * TODO: what about childs?
   */
  compileACL(action) {
    let acls = this.schema.acls;
    if (!acls) {
      return '*';
    }

  }


  /**
   * Get read chain
   *
   * @returns {[*,*,*,*]}
   */
  getReadChain() {
    return [
      this.handleReadACL,
      this.beforeRead,
      this.processRead,
      this.postHandleReadACL,
      // TODO: afterReadACL handling?
      this.afterRead
    ]
  }

  /**
   * Get create chain
   *
   * @returns {*[]}
   */
  getCreateChain() {
    return [
      this.handleCreateACL,
      this.validate,
      this.beforeCreate,
      this.processCreate,
      this.afterCreate
    ]
  }

  /**
   * Update chain
   *
   * @returns {*[]}
   */
  getUpdateChain() {
    return [
      this.handleUpdateACL,
      this.validate,
      this.beforeUpdate,
      this.processUpdate,
      this.afterUpdate
    ]
  }

  /**
   * Remove chain
   *
   * @returns {*[]}
   */
  getRemoveChain() {
    return [
      this.handleRemoveACL,
      this.validate,
      this.beforeRemove,
      this.processRemove,
      this.afterRemove
    ]
  }

  /**
   * Process chain
   *
   * @param chain
   * @param args
   * @returns {Promise.<{}>}
   */
  async processChain(chain, ...args) {

    let result = {};
    let isNext = false;
    let next = function() {
      isNext = true;
    };

    for (let fn of chain) {
      await fn.bind(this, result, next, ...args)();

      if (!isNext) {
        return result;
      }

      isNext = false;
    }

    return result;
  }

  /**
   * Mutate and get payload for create
   *
   * @param opts
   * @param input
   * @param ctx
   */
  async mutateAndGetPayloadCreate(opts, input, ctx) {
    opts.action = 'create';
    return await this.processChain(this.getCreateChain(), ...arguments);
  }

  /**
   * Mutate and get payload for update
   *1
   * @param opts
   * @param input
   * @param ctx
   * @returns {*}
   */
  async mutateAndGetPayloadUpdate(opts, input, ctx) {
    opts.action = 'update';
    return await this.processChain(this.getUpdateChain(), ...arguments);
  }

  /**
   * Mutate and get payload for Remove
   *
   * @param opts
   * @param input
   * @param ctx
   */
  async mutateAndGetPayloadRemove(opts, input, ctx) {
    opts.action = 'remove';
    return await this.processChain(this.getRemoveChain(), ...arguments);
  }

  /**
   * Resolve viewer
   * TODO: it should be part of only user model
   *
   * @param params
   * @param _
   * @param args
   * @param ctx
   * @returns {*}
   */
  resolveViewer(params, _, args, ctx) {
    // Get by auth token?
    //return this.model.findOne({
    //  "tokens.token": args.token
    //});

    return ctx.currentUser || {};
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
   * List items query arguments
   *
   * @returns {Object}
   */
  getGraphqlListArgs() {
    return {
      //limit: {
      //  name: 'Limit',
      //  type: GraphQLInt
      //},
      //sort: {
      //  name: 'Sort',
      //  type: GraphQLString
      //},
      //order: {
      //  name: 'Order',
      //  type: GraphQLInt
      //},
      // Relay pagination
      first: {
        name: 'first',
        type: GraphQLInt
      },
      last: {
        name: 'last',
        type: GraphQLInt
      },
      after: {
        name: 'after',
        type: GraphQLString
      },
      before: {
        name: 'before',
        type: GraphQLString
      },
      // Custom filter
      filter: {
        name: 'filter',
        type: GraphQLJSON
      }
    }
  }

  /**
   * Single item query arguments
   */
  getGraphqlItemArgs() {
    return {
      id: {
        name: 'id',
        type: GraphQLString
      }
    }
  }

  /**
   * Resolve list
   *
   * @returns {Array}
   */
  async resolveList(params, _, args, ctx) {
    try {
      return this.query(params, _, args);
    } catch (err) {
      console.error('error', err);
    }
  }

  /**
   * Query
   *
   * @param options
   * @param _
   * @param args
   */
  async query(options = {}, _, args) {}

  /**
   * Converts args to conditions
   *
   * @param args
   */
  argsToConditions(args) {

    if (!args || !args.filter) {
      return {}
    }

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
   * Entry point for resolving single item
   *
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {{}}
   */
  async resolveOne(options, _, args, ctx) {

    debug('resolveOne', options);

    options.actionType = 'one';

    //return this.resolveItem(options, _, args, ctx);

    return (await this.processChain(this.getReadChain(), ...arguments)).result;
  }

  /**
   * Entry point for resolving allItems
   *
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<{}>}
   */
  async resolveAll(options, _, args, ctx) {
    options.actionType = 'all';
    debug(this.getName(), 'resolveAll options', options);
    return (await this.processChain(this.getReadChain(), ...arguments)).result;
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
   * Function that used in hasMany dataloader for batch loading hasMany entires avoiding N+1 issue
   *
   * @returns {Promise.<void>}
   */
  async batchLoadHasMany(paramsCollection) {

    let _ = paramsCollection.map(params => params.arguments[0]);

    let args = clone(paramsCollection[0].arguments);
    args[0] = _;

    let options = paramsCollection[0].options;

    let fk = options.property.foreignKey;

    let result = await this.resolveHasMany(options, ...args);

    let edges = result.edges || [];

    debug(this.getName(), 'hasManyResolve result %j', result);

    // dataloader requires result to be returned strictly according to passed paramsCollection
    return paramsCollection.map((params) => {

      let id = params.arguments[0].id;
      // https://facebook.github.io/relay/graphql/connections.htm

      let result = edges.filter(e => {
        // TODO: we need to recalculate edge cursor as it's value make no sense in current case
        // TODO: but first - we need to refactor current pagination approach - not sure what cursors should be in hasMany case
        return e.node[fk].toString() === id.toString()
      });

      return {
        edges: result,
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false
          // TODO startCursor, endCursor
        }
      };
    });
  }

  /**
   * BelongsTo batching function for dataloader in order to avoid N+1 issue
   * TODO: in some cases we might queried parent items at ACL checking step
   * TODO: so we need to implement using of dataloader cache here
   *
   * @param paramsCollection
   * @returns {Promise.<void>}
   */
  async batchBelongsTo(paramsCollection) {

    let _ = paramsCollection.map(params => params.arguments[0]);

    let args = clone(paramsCollection[0].arguments);
    args[0] = _;

    let options = paramsCollection[0].options;

    let fk = options.property.foreignKey;
    let result = await this.resolveBelongsTo(options, ...args);

    let edges = result.edges || [];

    // dataloader requires result to be returned strictly according to passed paramsCollection
    return paramsCollection.map((params) => {

      let id = params.arguments[0][fk];

      // TODO: "edges" as we use same functions as for hasMany
      let result = edges.filter(e => {
        return e.node.id.toString() === id.toString()
      });

      return result[0] ? result[0].node : null;
    });
  }

  /**
   * Before read
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async beforeRead(result, next, options, _, args, ctx) {
    next();
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

  /**
   * After read
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async afterRead(result, next, options, _, args, ctx) {
    next();
  }
}