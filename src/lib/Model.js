const debug = require('debug')('spikenail:Model');
const hl = require('debug')('hl');

const clone = require('lodash.clone');
const isPlainObject = require('lodash.isplainobject');

const md5 = require('md5');

const sift = require('sift');

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

import connectionFromMongooseQuery from './components/RelayMongooseConnection';

// TODO: move constants to separate file
const ACTION_CREATE = Symbol('create');
const ACTION_UPDATE = Symbol('update');
const ACTION_REMOVE = Symbol('remove');
const ACTION_READ = Symbol('read');

// Default role system implementation

/**
 * Non authorized user
 * currentUser is not set
 *
 * @type {Symbol}
 */
const ROLE_ANONYMOUS = Symbol('anonymous');

/**
 * Any authorized user
 * currentUser is set
 *
 * @type {Symbol}
 */
const ROLE_USER = Symbol('user');

/**
 * Owner of the object
 * Usually currentUser.id == object.userId
 *
 * @type {Symbol}
 */
const ROLE_OWNER = Symbol('owner');

/**
 * Owner of the root object - the one belongsTo points to
 *
 * @type {Symbol}
 */
const ROLE_PARENT_OWNER = Symbol('root_owner');

const ROLE_MEMBER = Symbol('member');

const ROLE_PARENT_MEMBER = Symbol('root_member');

/**
 * Actually just custom role with some logic
 * currentUser.isAdmin == true
 *
 * @type {Symbol}
 */
const ROLE_ADMIN = Symbol('admin');

/**
 * Spikenail model
 */
export default class Model {

  /**
   * @constructor
   */
  constructor(schema) {
    try {

      debug('constructor', schema.name);

      this.schema = schema;

      // TODO: make name optional and pick the classname?
      this.name = schema.name;

      // For now, we are supporting only mongodb
      if (!schema.properties) {
        console.log('Warning - no schema properties');
        return;
      }

      // Expose model
      this.model = this.createAdapterModel(schema);
    } catch(err) {
      console.log('error', err);
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
    debug('validate', input);
    if (!this.schema.validations || !this.schema.validations.length) {
      debug('no vaidations defined - skip');
      return next();
    }

    // TODO filter validations by action
    debug('validate - validations found');

    let errors = await ValidationService.validate(input, this.schema.validations);

    if (errors.length) {
      result.errors = errors;
      return;
    }

    next();
  }

  /**
   * Handle create ACL
   *
   * @returns {Promise.<void>}
   */
  async handleCreateACL(result, next, options, _, args, ctx) {
    debug('handle Create ACL');

    // Create access map for current model, specifying only props that we trying to save
    let accessMap = new MongoAccessMap(this, ctx, { action: options.action, properties: Object.keys(_) });
    await accessMap.init();

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
    debug('data - after extracted keys', input);

    // Check if access map has dependent rules
    if (accessMap.hasDependentRules()) {
      debug('access map has dependent rules - fetch dep data');
      // Fetch dependent data and apply
      let data = await this.fetchDataForDependentRules(accessMap, input);
      debug('fetched data', data);
      accessMap.applyDependentData(data);
      accessMap.buildRuleSetQueries();

      // Check one more time - as applying dependent data might produce false values
      if (accessMap.hasAtLeastOneFalseValue()) {
        debug('additional check of at least one false value');
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }
    }

    // Check for all true values
    if (accessMap.isPassing()) {
      debug('access map is passing - continue');
      return next();
    }

    // If not passing and does not have at least one false value - try to build query
    let query = await accessMap.getQuery();

    // Apply query on input data to check

    debug('query', query, 'data', [input]);

    let siftResult = sift(query, [input]);

    debug('siftResult', siftResult);

    if (!siftResult.length) {
      debug('sift - false');
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    debug('all nice - continue');
    next();
  }

  /**
   * Handle update ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<*>}
   */
  async handleUpdateACL(result, next, options, _, args, ctx) {

    debug('handle Update ACL _', _, result);

    let accessMap = new MongoAccessMap(this, ctx, { action: options.action, properties: Object.keys(_) });
    await accessMap.init();

    debug('access map initialized');

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

    debug('check if passing');

    if (accessMap.isPassing()) {
      debug('access map is passing');
      return next();
    }

    let id = fromGlobalId(_.id).id;

    debug('input', id);

    let input = this.extractInputKeys(_);

    debug('input with extracted keys', input);

    // We need fetch the document anyway
    // TODO: we need to cache this with data loader in order to avoid race-condition issues
    // TODO: and not to fetch same doc twice
    let doc = await this.query.bind(this, {
      method: 'findOne',
      query: { _id: new mongoose.Types.ObjectId(id) }
    }, _, args)();

    if (!doc) {
      debug('no document found');
      //TODO: should we have explicit difference between not found and 403?
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];
      return;
    }

    if (accessMap.hasDependentRules()) {
      debug('access map has dependent rules');

      let modelsMap = await this.fetchDataForDependentRules(accessMap, doc);

      debug('apply dependent data');
      accessMap.applyDependentData(modelsMap);

      hl('after apply dep data', accessMap.accessMap);

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
    }

    let query = await accessMap.getQuery();
    debug('query:', query);

    let siftResult = sift(query, [doc]);
    debug('first siftResult', siftResult);

    if (!siftResult.length) {
      debug('sift - false');
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    debug('first sift result is fine');

    // In some cases we have to do and additional ACL check
    // It is needed if we are changing foreign keys
    // TODO: check that we even changing relations affected by dependent rules
    if (accessMap.initialProps.hasDependentRules) {
      debug('additional acl check is needed');
      // Create access map only for dependent rules
      // check one more time
      let accessMap = new MongoAccessMap(this, ctx, {
        action: options.action,
        properties: Object.keys(_),
        onlyDependentRules: true
      });
      await accessMap.init();

      debug('access map with only dep rules', accessMap.accessMap);

      let newDoc = Object.assign({}, doc.toObject(), input);
      debug('newDoc', newDoc);

      debug('before fetch data for dep rules');
      // Apply dependent data based on input
      let modelsMap = await this.fetchDataForDependentRules(accessMap, newDoc);

      debug('apply dependent data on input', modelsMap);
      accessMap.applyDependentData(modelsMap);
      hl('after apply dep data on input', accessMap.accessMap);

      if (accessMap.hasAtLeastOneFalseValue()) {
        debug('second access map has at least one false');
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }

      if (accessMap.isPassing()) {
        debug('second access map is passing');
        return next();
      }

      let query = await accessMap.getQuery();
      debug('second query:', query);

      let siftResult = sift(query, [newDoc]);
      debug('SECOND siftResult', siftResult);

      if (!siftResult.length) {
        debug('sift - false');
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }
    }

    debug('all fine go next');

    next();
  }

  /**
   * Handle remove ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async handleRemoveACL(result, next, options, _, args, ctx) {
    let accessMap = new MongoAccessMap(this, ctx, { action: options.action, properties: Object.keys(_) });
    await accessMap.init();

    // If access map has at least one strict false value we throw 403 error
    // We can't just trim this value and save all other, as it might lead to misunderstanding
    if (accessMap.hasAtLeastOneTrueValue()) {
      debug('has at least one true - success');
      return next();
    }

    if (accessMap.isFails()) {
      debug('access map fails');
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    debug('access map is not determined');

    // TODO: almost copypaste of update ACL

    let id = fromGlobalId(_.id).id;

    debug('input', id);

    let input = this.extractInputKeys(_);

    debug('input with extracted keys', input);

    // We need fetch the document anyway
    // TODO: we need to cache this with data loader in order to avoid race-condition issues
    // TODO: and not to fetch same doc twice
    let doc = await this.query.bind(this, {
      method: 'findOne',
      query: { _id: new mongoose.Types.ObjectId(id) }
    }, _, args)();

    if (!doc) {
      debug('no document found');
      //TODO: should we have explicit difference between not found and 403?
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];
      return;
    }

    if (accessMap.hasDependentRules()) {
      debug('access map has dependent rules');

      let modelsMap = await this.fetchDataForDependentRules(accessMap, doc);

      debug('apply dependent data');
      accessMap.applyDependentData(modelsMap);

      hl('after apply dep data', accessMap.accessMap);

      if (accessMap.hasAtLeastOneTrueValue()) {
        debug('has at least one true - success');
        return next();
      }

      if (accessMap.isFails()) {
        debug('access map fails');
        result.errors = [{
          message: 'Access denied',
          code: '403'
        }];

        return;
      }
    }

    let query = await accessMap.getQuery();
    debug('query:', query);

    let siftResult = sift(query, [doc]);
    debug('first siftResult', siftResult);

    if (!siftResult.length) {
      debug('sift - false');
      result.errors = [{
        message: 'Access denied',
        code: '403'
      }];

      return;
    }

    debug('all is fine');

    next();
  }

  /**
   * Input data will have global id but we can only work internally with database id
   */
  extractInputKeys(data) {
    debug('extract input keys');

    let input = clone(data);

    for (let key of Object.keys(input)) {
      let prop = this.schema.properties[key];

      if (prop.type == 'id') {
        input[key] = fromGlobalId(input[key]).id;
      }
    }

    debug('input with extracted keys', input);
    return input;
  }

  /**
   * Set ACL defaults etc
   */
  initializeACLs() {
    if (!this.schema.acls) {
      return;
    }

    for (let rule of this.schema.acls) {
      if (!rule.properties) {
        rule.properties = ['*'];
      }
    }
  }

  /**
   * Handle ACL
   *
   * @deprecated
   *
   * @param result
   * @param next
   * @param opts
   * @param input
   * @param ctx
   */
  async handleACL(result, next, opts, input, ctx) {
    debug('handleACL', result, opts, input);

    if (!this.schema.acls || !this.schema.acls.length) {
      debug('no acls defined');
      return next();
    }

    // In order to avoid unnecessary roles checking
    // Extract possible roles from ACL rules
    let possibleRoles = this.getPossibleRoles(this.schema.acls);
    debug('possibleRoles', possibleRoles);

    let roles = await this.getRoles(possibleRoles, opts, input, ctx);
    debug('roles', roles);

    let accessMap = this.createAccesMap(opts, input, roles, this.schema.acls);

    debug('accessMap', accessMap);

    // TODO: it is only crud acl, in fetch case logic could change
    let access = Object.keys(accessMap).every(key => accessMap[key]);
    debug('result', result);

    // If everything is fine — continue
    if (access) {
      return next();
    }

    // else show an error?
    result.errors = [{
      message: 'Access denied',
      code: '403'
    }];
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
    debug('handleReadACL');
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
    debug('postHandleReadACL');

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
    debug('handleOneACL');

    let accessMap = new MongoAccessMap(this, ctx, { action: 'read' });
    await accessMap.init();

    // Store access map in the context
    // TODO: here we are probably overriding previous accessMap of parent items.
    // TODO: any potential issue? It is still the same context I guess
    ctx.accessMap = accessMap;

    if (accessMap.isFails()) {
      debug('access map fails - interrupt chain');
      return;
    }

    // TODO: The only deference between all methods is prefetch algorithm - handle it!
    /// GOOD point that we don't need to prefetch
    // Check if we need to make a preliminarily request of some data to build final access map
    // TODO: anyway it is better to fetch here and put in dataloader cache
    // TODO: it is very not obvious flow
    if (!accessMap.hasAtLeastOneTrueValue() && accessMap.hasDependentRules()) {
      debug('skip ACL check because of dep rules - it will be handled later');
      // because of dependent rules we need to fetch this doc anyway to know parent id
      // the acl will be handled in postACL method
      return next();
    }

    // Compile access map to single query

    // We don't need apply query if no documents can be skipped
    if (accessMap.hasAtLeastOneTrueValue()) {
      debug('Not need to apply query - no documents might be skipped');
      return next();
    }

    debug('need to apply query');

    // Try to build query as we possibly need it
    let query = await accessMap.getQuery();

    if (!query) {
      debug('No query was produced');
      return next();
    }

    debug('applying query', query);

    // Apply query
    options.query = Object.assign(options.query || {}, query);

    debug('applied query', options.query);

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
    debug('handle has many ACL');
    debug('_', _);

    let accessMap = new MongoAccessMap(this, ctx, { action: 'read' });
    await accessMap.init();

    // Store access map in the context
    // TODO: here we are probably overriding previous accessMap of parent items.
    // TODO: any potential issue? It is still the same context I guess
    ctx.accessMap = accessMap;

    if (accessMap.isFails()) {
      debug('access map fails - interrupt chain');
      return;
    }

    // Check if we need to make a preliminarily request of some data to build final access map
    if (!accessMap.hasAtLeastOneTrueValue() && accessMap.hasDependentRules()) {
      // TODO: one possible issue is that parent object might not have enough fields requested
      // TODO: in order to do later acl check. We need request additional fields.
      // TODO: or better - determine if hasMany items requested and what fields needed for acl check and add them
      // TODO: currently we are requesting the whole document anyway
      // TODO: additionally we can optimize acl rules that only have "test: parent" rule
      // TODO: in that case no need to check anything
      hl('Need to perform pre-querying data');

      // Get dependent rules compiled in single query
      let dependentModelQueries = accessMap.getCompiledDependentModelQueries();
      debug('compiled dependent queries', dependentModelQueries);

      // TODO: use Promise.all
      for (let data of Object.values(dependentModelQueries)) {
        // if data already exists no need to query
        // check if _ instance of model model model
        hl('prefetch data iteration');

        if (_[0] instanceof data.model.model) {
          hl('_ instance of model! no need to fetch');
          data.data = _;
          continue;
        }

        data.data = await data.model.model.find(data.query);
      }

      debug('models with queried data', dependentModelQueries);

      // Apply dependent data
      accessMap.applyDependentData(dependentModelQueries);

      debug('acceessMap with applied data', accessMap);
    }

    // Compile access map to single query

    // We don't need apply query if no documents can be skipped
    if (accessMap.hasAtLeastOneTrueValue()) {
      debug('Not need to apply query - no documents might be skipped');
      return next();
    }

    debug('need to apply query');

    // Try to build query as we possibly need it
    let query = await accessMap.getQuery();

    if (!query) {
      debug('No query was produced');
      return next();
    }

    debug('applying query', query);

    // Apply query
    options.query = Object.assign(options.query || {}, query);

    debug('applied query', options.query);

    next();
  }

  /**
   * New realization through accessMap classes
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   * @private
   */
  async handleReadAllACL(result, next, options, _, args, ctx) {

    debug('handleReadAllACL');

    // TODO: pass requested (+dependent) fields in options
    let accessMap = new MongoAccessMap(this, ctx, { action: 'read' });
    await accessMap.init();

    // Store access map in the context
    ctx.accessMap = accessMap;

    if (accessMap.isFails()) {
      debug('access map fails - interrupt chain');
      return;
    }

    // Check if we need to make a preliminarily request of some data to build final access map
    if (!accessMap.hasAtLeastOneTrueValue() && accessMap.hasDependentRules()) {

      debug('Need to perform pre-querying data');

      // Get dependent rules compiled in single query
      let dependentModelQueries = accessMap.getCompiledDependentModelQueries();
      debug('compiled dependent queries', dependentModelQueries);

      // TODO: use Promise.all
      for (let data of Object.values(dependentModelQueries)) {
        // TODO: we might not want to call mongo query explicitly here
        // TODO: we need to query only limited set of fields
        // TODO: e.g. the query is { param: 123 }, then we only need "param" field
        data.data = await data.model.model.find(data.query);
      }

      debug('models with queried data', dependentModelQueries);

      // Apply dependent data
      accessMap.applyDependentData(dependentModelQueries);

      debug('acceessMap with applied data', accessMap);
    }

    // Compile access map to single query

    // We don't need apply query if no documents can be skipped
    if (accessMap.hasAtLeastOneTrueValue()) {
      debug('Not need to apply query - no documents might be skipped');
      return next();
    }

    debug('need to apply query');

    // Try to build query as we possibly need it
    let query = await accessMap.getQuery();

    if (!query) {
      debug('No query was produced');
      return next();
    }

    debug('applying query', query);

    // Apply query
    options.query = Object.assign(options.query || {}, query);

    debug('applied query', options.query);

    next();
  }

  /**
   *
   * @param accessMap
   * @param data current data
   */
  async fetchDataForDependentRules(accessMap, sourceData) {

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
        foreignKey: this.schema.properties[modelName].foreignKey,
        ids: new Set()
      }
    }

    hl('initial modelsMap', modelsMap);

    // Fill ids array of modelsMap
    for (let doc of data) {
      for (let val of Object.values(modelsMap)) {
        hl('fk, doc %j', val.foreignKey, doc);
        if (doc[val.foreignKey]) {
          hl('add id', val.foreignKey, doc[val.foreignKey]);
          val.ids.add(doc[val.foreignKey]);
        }
      }
    }

    hl('filled models map', modelsMap);

    // Then iterate map perform queries
    // TODO: we need only limited fields to be fetched
    // TODO: use Promise.all
    for (let val of Object.values(modelsMap)) {

      hl('fetching ids', val.ids);

      // TODO: handle not found case
      val.data = await val.model.model.find({ _id: { '$in': Array.from(val.ids) } });
      hl('fetched data', val.data);
    }

    hl('map with queried data %j', modelsMap);

    debug('apply dependent data');
    //ctx.accessMap.applyDependentData(modelsMap);

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
    debug('applyAccessMapToData', data);

    return data.map(sourceDoc => {
      let doc = clone(sourceDoc);
      hl('apply accessMapToData- doc iteration', doc);

      // Cache query results
      let testedQueries = {};
      for (let prop of Object.keys(accessMap.accessMap)) {
        let val = accessMap.accessMap[prop];

        debug('accessMap val %j', val);
        let allow;

        if (typeof(val) ==='boolean') {
          allow = val;
        } else {
          debug('not boolean value');
          let query = val.query;

          hl('query', val.query);
          // Apply query on object
          // TODO: we don't need md5
          let queryId = md5(JSON.stringify(query));
          // Check for cached result
          if (testedQueries[queryId] !== undefined) {
            allow = testedQueries[queryId];
            debug('extract allow from cache', allow);
          } else {
            debug('need to apply query %j', query);
            debug('to data', [doc]);
            // Apply query
            // TODO: probably, we should put data formatting in the last middleware
            // TODO: and not access node here
            let queryResult = sift(query, [doc]);

            if (queryResult.length) {
              hl('query matched doc');
              allow = true;
            } else {
              hl('query does not match the doc');
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

        debug('doc iteration result', doc);
      }

      debug('resulting doc', doc);

      return doc;
    }); // TODO: should we apply filter and remove all-null objects
  }

  /**
   * handle read one acl
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
    hl('postHandleReadOneACL', ctx.accessMap);
    hl('%j', ctx.accessMap.accessMap, ctx.accessMap.accessMap.id);

    debug('result', result);

    // Skip if no access map defined
    if (!ctx.accessMap) {
      debug('no access map defined for postACL');
      return next();
    }

    // Skip for empty result
    if (!result || !result.result) {
      debug('no result - skip');
      return next();
    }

    debug('initProps dep', ctx.accessMap.initialProps.hasDependentRules);
    debug('initProps has true', ctx.accessMap.initialProps.hasAtLeastOneTrueValue);

    // Access map might be changed to this step, but we need to check initial configuration
    // TODO: replace not obvious check with something like hasUnresolvedDependencies
    // TODO: it is very unclear why we are checking it below
    if (ctx.accessMap.initialProps.hasDependentRules) {
      hl('accessMap has dependent rules and not able to skip values');

      let modelsMap = await this.fetchDataForDependentRules(ctx.accessMap, result.result);

      debug('apply dependent data');
      ctx.accessMap.applyDependentData(modelsMap);

      hl('after apply dep data', ctx.accessMap.accessMap);
    }

    ctx.accessMap.buildRuleSetQueries();

    // TODO: We need to put data formatting at last step
    let data = [result.result];

    let resultData = this.applyAccessMapToData(ctx.accessMap, data);

    debug('resultData', resultData);

    result.result = resultData[0] || null;

    next();
  }

  /**
   * Handle read all ACL after data is fetched
   * In this method we should filter resulting data according an access map
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   */
  async postHandleReadAllACL(result, next, options, _, args, ctx) {
    debug('postHandleReadAllACL', ctx.accessMap);

    debug('result', result);

    // Skip if no access map defined
    if (!ctx.accessMap) {
      debug('no access map defined for postACL');
      return next();
    }

    // Skip for empty result
    if (!result.result || !result.result.edges || !result.result.edges.length) {
      debug('no result - skip');
      return next();
    }

    // Skip for plain access map with no queries
    // TODO

    // Skip for access map with one query covering all values
    // TODO

    // Check if we need to prefetch some parent data
    // If access map have some dependent rules
    // Check that access map has dependent rules and they were no handled before

    // Access map might be changed to this step, but we need to check initial configuration
    if (ctx.accessMap.initialProps.hasDependentRules && ctx.accessMap.initialProps.hasAtLeastOneTrueValue) {
      debug('accessMap has dependent rules and not able to skip values');

      // lets get needed relations and foreignKeys in order to collect parent ids
      // iterate dependent rules
      // build models map
      let dependentRules = ctx.accessMap.getDependentRules();

      let modelsMap = {};
      for (let rule of dependentRules) {
        let model = ctx.accessMap.getDependentModel(rule);
        let modelName = model.getName();

        // Initialize
        if (modelsMap[modelName]) {
          continue;
        }

        modelsMap[modelName] = {
          model: model,
          foreignKey: this.schema.properties[modelName].foreignKey,
          ids: new Set()
        }
      }

      debug('initial modelsMap', modelsMap);

      // Fill ids array of modelsMap
      for (let edge of result.result.edges) {
        let doc = edge.node;

        for (let val of Object.values(modelsMap)) {
          if (doc[val.foreignKey]) {
            val.ids.add(doc[val.foreignKey]);
          }
        }
      }

      debug('filled models map', modelsMap);

      // Then iterate map perform queries
      // TODO: we need only limited fields to be fetched
      // TODO: use Promise.all
      for (let val of Object.values(modelsMap)) {
        val.data = await val.model.model.find({ _id: { '$in': Array.from(val.ids) } })
      }

      debug('map with queried data', modelsMap);

      debug('apply dependent data');
      ctx.accessMap.applyDependentData(modelsMap);
    }

    // Applying queries from accessMap to resulting data
    // TODO: probably, we should put data formatting in the last middleware
    // TODO: and not access edges here

    // TODO: we need some condition to skip this part
    // TODO: because some acls might be very simple or not exists at all
    // TODO: at least accessMap.hasRules()

    // TODO: should no run if not needed - only one set of rules applied to all fields
    result.result.edges = result.result.edges.map(sdoc => {

      let doc = clone(sdoc);

      hl('postacl - doc iteration', doc);

      // iterate through rules
      // TODO: move to another method

      // Cache query results
      let testedQueries = {};

      for (let prop of Object.keys(ctx.accessMap.accessMap)) {
        let val = ctx.accessMap.accessMap[prop];

        debug('accessMap val %j', val);
        let allow;

        if (typeof(val) ==='boolean') {
          allow = val;
        } else {
          debug('not boolean value');
          let query = val.query;

          hl('query', val.query);
          // Apply query on object
          // TODO: we don't need md5
          let queryId = md5(JSON.stringify(query));
          // Check for cached result
          if (testedQueries[queryId] !== undefined) {
            allow = testedQueries[queryId];
            debug('extract allow from cache', allow);
          } else {
            debug('need to apply query %j', query);
            debug('to data', [doc.node]);
            // Apply query
            // TODO: probably, we should put data formatting in the last middleware
            // TODO: and not access node here
            let queryResult = sift(query, [doc.node]);

            if (queryResult.length) {
              hl('query matched doc');
              allow = true;
            } else {
              hl('query does not match the doc');
              allow = false;
            }
            testedQueries[queryId] = allow;
          }
        }

        if (!allow) {

          // FIXME: quick workaround
          if (prop == 'id') {
            doc.node['_id'] = null;
            continue;
          }

          // TODO: probably, we should put data formatting in the last middleware
          // TODO: and not access node here
          // TODO: should we actually remove property completely with delete
          // TODO: we currently operate with mongoose objects
          // TODO: should we ever convert it to plain objects
          doc.node[prop] = null;
        }

        debug('doc iteration result', doc);
      }

      debug('resulting doc', doc);

      return doc;
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
    let roles = {
      owner: {
        cond: (ctx) => { userId: ctx.currentUser }
      }
    };

    return Object.assign(roles, this.schema.roles || {} );
  }

  /**
   * Get dynamic role names
   * @returns {Array}
   */
  getDynamicRoleNames(ctx) {
    return Object.keys(this.getDynamicRoles(ctx));
  }

  /**
   * Based on action, roles and ACL rules returns map of allowed fields to access
   *
   * This method is currently used only for Create, delete, update actions and will be replaced
   *
   * @deprecated
   *
   * @param action
   * @param roles
   * @param rules
   */
  createAccessMap(opts, input, roles, rules) {
    let action = opts.action;
    debug('createAccessMap', action, roles, rules, input, opts);

    // Everything is acceptable by default
    let accessMap = {};
    Object.keys(input).forEach(field => {
      accessMap[field] = true;
    });

    for (let rule of this.schema.acls) {
      debug('iterating rules', rule);

      if (!rule.actions || !rule.roles || rule.allow === undefined) {
        debug('invalid rule', rule);
        throw new Error('Invalid rule');
      }

      if (!Array.isArray(rule.actions)) {
        rule.actions = [rule.actions];
      }

      // Filter rule by action
      if (!~rule.actions.indexOf('*') && !~rule.actions.indexOf(opts.action)) {
        debug('rule does not apply to action - skip', opts.actions);
        continue;
      }

      // Filter rule by role
      // Check if rule does not match current role
      debug('checking role matching');
      if (!~rule.roles.indexOf('*') && !rule.roles.filter(r => ~roles.indexOf(r)).length) {
        debug('rule does not apply to the roles');
        continue;
      }

      // Wildcard
      debug('check wildcard, property matching');
      if (!rule.properties || ~rule.properties.indexOf('*')) {
        debug('No rule properties specified or wildcard');

        Object.keys(input).forEach(field => {
          accessMap[field] = rule.allow;
        });

        continue;
      }

      debug('role properties iteration');

      // TODO: we should not exclude any of fields from accessMap
      // TODO: and then not check that all fields are true
      // TODO: but compare with input
      for (let property of rule.properties) {
        if (~Object.keys(input).indexOf(property)) {
          accessMap[property] = rule.allow;
        }
      }
    }

    return accessMap;
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
   * Default implementation of get role algorithm
   * However there is could be any custom implementation
   *
   * @param possibleRoles
   * @param opts
   * @param input
   * @param ctx
   * @returns {*[]}
   */
  async getRoles(possibleRoles, opts, input, ctx) {
    debug('getRoles');
    let currentUser = this.getCurrentUserFromContext(ctx);
    if (!currentUser) {
      return [ROLE_ANONYMOUS];
    }

    let roles = [ROLE_USER];
    // Get roles of specific action

    // For action of create there is no role OWNER
    if (opts.action == 'create') {
      // TODO!!!
    }

    if (opts.action == 'update' || opts.action == 'remove') {
      return [...roles, ...this.getExistingItemRoles(currentUser, possibleRoles, opts, input, ctx)];
    }

    return roles;
  }

  /**
   * Get roles in case we are working with existing item
   * update and remove actions
   *
   * @param possibleRoles
   * @param currentUser
   * @param opts
   * @param input
   * @param ctx
   * @returns {Array}
   */
  async getExistingItemRoles(currentUser, possibleRoles, opts, input, ctx) {
    let roles = [];

    if (!input.id) {
      return [];
    }

    // ROLE_OWNER check
    if (~possibleRoles.indexOf(ROLE_OWNER)) {
      // TODO: Caching: use dataloader here
      let item = await this.model.findOne(input.id);
      if (!item || !item.id) {
        return [];
      }

      if (this.getItemOwnerId(item) == currentUser.id) {
        roles.push(ROLE_OWNER);
      }
    }

    // For some cases we need to check both original object and input data

    // parent checking
    for (let role of possibleRoles) {
      // Check if role is object
      if (role !== Object(role)) {
        continue;
      }

      // TODO:
    }

    return roles;
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
    debug('processChain');

    let result = {};
    let isNext = false;
    let next = function() {
      debug('next called');
      isNext = true;
    };

    for (let fn of chain) {
      debug('chain iteration');
      await fn.bind(this, result, next, ...args)();

      if (!isNext) {
        debug('no isNext. Return result', result);
        return result;
      }

      debug('go to next iteration');
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
    debug('mutateAndGetPayloadCreate');
    return await this.processChain(this.getCreateChain(), ...arguments);
  }

  /**
   * Mutate and get payload for update
   *
   * @param opts
   * @param input
   * @param ctx
   * @returns {*}
   */
  async mutateAndGetPayloadUpdate(opts, input, ctx) {
    opts.action = 'update';
    debug('mutateAndGetPayload - update', opts, input);
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
    debug('mutateAndGetPayload - remove', opts, input);
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
      debug('resolveList', _, args);
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
    debug('resolveAll', options);
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

    debug('resolveHasMany ids', ids);

    // Specifying additional condition
    options.query = {
      //[options.property.foreignKey]: _._id
      [options.property.foreignKey]: { '$in': ids }
    };

    options.actionType = 'hasMany';

    debug('resolveHasMany', options);

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

    debug('belongsTo');

    if (!Array.isArray(_)) {
      _ = [_];
    }

    let ids = _.map(item => item[options.property.foreignKey]);

    debug('ids', ids);

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
    hl('dataLoader invoked', paramsCollection);

    let _ = paramsCollection.map(params => params.arguments[0]);

    let args = clone(paramsCollection[0].arguments);
    args[0] = _;

    let options = paramsCollection[0].options;

    let fk = options.property.foreignKey;

    hl('options', options);
    hl('fk', fk);

    let result = await this.resolveHasMany(options, ...args);

    let edges = result.edges || [];

    hl('hasManyResolve result', result);

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
    hl('batchBelongsTo');

    let _ = paramsCollection.map(params => params.arguments[0]);

    let args = clone(paramsCollection[0].arguments);
    args[0] = _;

    let options = paramsCollection[0].options;

    let fk = options.property.foreignKey;

    hl('options', options);
    hl('fk', fk);

    let result = await this.resolveBelongsTo(options, ...args);

    hl('resolveBelongsTo result', result);

    let edges = result.edges || [];

    // dataloader requires result to be returned strictly according to passed paramsCollection
    return paramsCollection.map((params) => {

      let id = params.arguments[0][fk];

      hl('params - fk id', id);

      // TODO: "edges" as we use same functions as for hasMany
      let result = edges.filter(e => {


        hl('id comparison', e.node.id, id);

        return e.node.id.toString() === id.toString()
      });

      hl('result[0]', result[0]);

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
    debug('beforeRead');
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
    debug('processRead');

    // TODO: lets handle it here for now:
    if (options.actionType === 'one') {
      debug('processOne - apply single item query');
      options.method = 'findOne';

      if (!options.query) {
        options.query = {};
      }
      // TODO: don't actually remember why we have to select options.id or args.id
      Object.assign(options.query, { _id: new mongoose.Types.ObjectId(options.id || args.id) });
    }

    result.result = await this.query.bind(this, options, _, args)();
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
    debug('afterRead', result);
    next();
  }
}