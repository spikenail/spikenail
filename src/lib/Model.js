const debug = require('debug')('spikenail:Model');

const clone = require('lodash.clone');
const isPlainObject = require('lodash.isplainobject');

const md5 = require('md5');

const sift = require('sift');

import mongoose from 'mongoose';

import Spikenail from './Spikenail';

import ValidationService from './services/Validation/ValidationService';

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
   * Handle ACL
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

    let accessMap = this.createAccessMap(opts, input, roles, this.schema.acls);

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

    }

    if (options.actionType == 'one') {

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
  }

  /**
   * Read all items ACL
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   */
  async handleReadAllACL(result, next, options, _, args, ctx) {
    debug('handleReadAllACL');
    let acls = this.schema.acls;

    debug('source acls', acls);

    // Lets get user roles.
    //let roles = await this.getStaticRoles(ctx);
    //debug('staticRoles', roles);

    // TODO: first of all apply default values - make it once on models initialization step

    // TODO: Before filtering ACL rules - handle injecting of relation rules
    let staticRoles = this.getStaticRoles(ctx);

    // Some roles are depends on the object
    // Modify and filter ACLs according to current request
    let filteredAcls = acls
      .filter(this.isRuleMatchAction('read'))
      .map(this.removeImpossibleRoles.bind(this, ctx))
      .map(this.markAsDeferred.bind(this, staticRoles))
      .filter(rule => !!rule.roles.length);

    debug('filtered acls', filteredAcls);

    let accessMap = await this.buildAccessMap(filteredAcls, ctx);

    // Now we have to analyze resulting access map.
    // TODO: Optimization: first of ALL we have to subtract Requested fields - propbbly before building map
    // TODO: because we probably don't need to execute deferred actions

    // Check if all access map is false
    if (this.isAccessMapFails(accessMap)) {
      debug('access map fails - interrupt execution');
      return;
    }

    // Build query from access map
    let query = await this.accessMapToQuery(accessMap, ctx);
    ctx.queryableAccessMap = this.toQueryableAccessMap(accessMap, ctx);

    debug('resulting query %j', query);

    if (!query) {
      debug('no query was produced');
      return next();
    }

    // The query should not be applied if there is at least one property with allow: true
    let shouldApplyQuery = true;
    for (let allow of Object.values(accessMap)) {
      if (allow === true) {
        shouldApplyQuery = false;
        break;
      }
    }

    debug('shouldApplyQuery', shouldApplyQuery);

    if (!shouldApplyQuery) {
      debug('we should not apply query for now - go next');
      return next();
    }

    debug('apply query');

    // TODO 2: Apply query after result is fetched
    // As conditions could control different set of fields

    // Apply query
    options.query = Object.assign(options.query || {}, query);

    debug('applied query', options.query);

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
    let accessMap = ctx.queryableAccessMap;

    if (!accessMap) {
      debug('no access map defined for postACL');
      return next();
    }

    // TODO: check that we need it. We might not need it at all
    debug('postHandleReadAllACL');
    debug('ACCESSMAP', accessMap);
    debug('result', result);

    // We have to filter all data according to accessMap
    // TODO: probably, we should put data formatting in the last middleware
    // TODO: and not access edges here

    result.result.edges = result.result.edges.map(sdoc => {

      let doc = clone(sdoc);

      debug('postacl - doc iteration', doc);

      // iterate through rules
      // TODO: move to another method

      // Cache query results
      let testedQueries = {};

      for (let prop of Object.keys(accessMap)) {
        let val = accessMap[prop];

        debug('accessMap val %j', val);
        let allow;

        if (typeof(val) == "boolean") {
          allow = val;
        } else {
          debug('not boolean value');
          // Apply query on object
          let queryId = md5(JSON.stringify(val));
          // Check for cached result
          if (testedQueries[queryId] !== undefined) {
            allow = testedQueries[queryId];
            debug('extract allow from cache', allow);
          } else {
            debug('need to apply query %j', val);
            // Apply query
            // TODO: probably, we should put data formatting in the last middleware
            // TODO: and not access node here
            if (sift(val, [doc.node]).length) {
              debug('query matched doc');
              allow = true;
            } else {
              debug('query does not match the doc');
              allow = false;
            }
            testedQueries[queryId] = allow;
          }
        }

        if (!allow) {
          // TODO: probably, we should put data formatting in the last middleware
          // TODO: and not access node here
          // TODO: should we actually remove property completely with delete
          // TODO: we currently operate with mongoose objects
          // TODO: should we ever convert it to plain objects
          doc.node[prop] = null;
        }
      }

      debug('resulting doc', doc);

      return doc;
    });

    next();
  }

  /**
   * Check that all elements of access map equals false
   *
   * @param accessMap
   */
  isAccessMapFails(accessMap) {
    debug('isAccessMapFails', accessMap);
    return Object.values(accessMap).every(item => {
      if (typeof(item) !== "boolean") {
        return false;
      }

      return !item;
    });
  }

  /**
   * Access map to query
   *
   * @param accessMap
   * @param ctx
   * @returns {Promise.<*>}
   */
  async accessMapToQuery(accessMap, ctx) {
    //let staticQuery = this.accessMapToStaticQuery(accessMap);

    debug('accessMapToQuery');

    let queries = {};

    for (let ruleSet of Object.values(accessMap)) {

      debug('iterating rule of accessMap', ruleSet);

      if (typeof(ruleSet) === "boolean") {
        debug('rule type is boolean - continue');
        continue;
      }

      // calculate unique rule set hash
      let hash = this.toHash(ruleSet);
      debug('ruleSet hash', hash);

      // we should convert rule set to query only once
      if (queries[hash]) {
        debug('rules already converted - skip');
        continue;
      }

      queries[hash] = this.ruleSetToQuery(ruleSet, ctx);
    }

    queries = Object.values(queries);

    debug('Resulting queries array', queries);

    if (!queries.length) {
      debug('No queries');
      return null;
    }

    // TODO: Probably use something like conditionsToOrQuery
    if (queries.length > 1) {
      return { '$or': queries };
    }

    return queries[0];
  }

  /**
   * Replace set of rules in access map with queries
   * TODO: use this method in accessMapToQuery
   *
   * @param sourceAccessMap
   */
  toQueryableAccessMap(sourceAccessMap, ctx) {

    debug('toQueryableAccessMap');

    let accessMap = clone(sourceAccessMap);

    let queries = {};

    for (let key of Object.keys(accessMap)) {
      let ruleSet = accessMap[key];

      debug('iterating rule of accessMap', ruleSet);

      if (typeof(ruleSet) === "boolean") {
        debug('rule type is boolean - continue');
        continue;
      }

      // calculate unique rule set hash
      let hash = this.toHash(ruleSet);
      debug('ruleSet hash', hash);

      this.ruleSetToQuery(ruleSet, ctx);

      // we should convert rule set to query only once
      if (queries[hash]) {
        accessMap[key] = queries[hash];
        continue;
      }

      let queryVal = this.ruleSetToQuery(ruleSet, ctx);
      accessMap[key] = queryVal;
      queries[hash] = queryVal;
    }

    return accessMap;
  }

  /**
   * To hash
   * @param data
   */
  toHash(data) {
    return md5(JSON.stringify(data));
  }

  /**
   * Converts ruleSet to query condition
   *
   * @param ruleSet
   * @param ctx
   */
  ruleSetToQuery(ruleSet, ctx) {
    debug('ruleSetToQuery', ruleSet);

    // Lets expand each rule in rule set
    // That mean convert role to condition and merge it with scope
    // Build queries set. Convert each individual rule to query
    // we assume that there is only dynamic roles left
    let queriesSet = ruleSet.map((rule) => {

      let model = this.isDependentRule(rule) ? this.getDependentModel(rule) : this;
      debug('building queries set');
      //debug('model', this);

      let query = {};

      if (rule.scope) {
        debug('scope exists', rule.scope);
        // TODO: what arguments?
        query = rule.scope();
        debug('scope query', query);
      }

      if (!rule.roles) {
        debug('no rule roles or *');
        return {
          allow: rule.allow,
          query: query
        };
      }

      let conds = [];
      // Finding only dynamic roles
      for (let roleName of rule.roles) {
        debug('iterating rule role:', roleName);
        let role = model.schema.roles ? model.schema.roles[roleName] : null;

        if (!role) {
          // This actually could happen because our rule might be dynamic only because of scope
          debug('Role not in possible dynamic roles');
          continue;
        }

        debug('found dynamic role definition:', role);
        // Execute handler
        // TODO: could it be async? On what data it depends? Should we execute it multiple times?

        let cond = Object.assign(role.cond(ctx), query);
        debug('calculated cond + query', cond);
        conds.push(cond);
      }

      debug('OR Conditions', conds);
      if (!conds.length) {
        debug('finally no conditions built using dynamic roles');
        return {
          allow: rule.allow,
          query: query
        };
      }

      let result = {};

      // check if more than one condition
      if (conds.length > 1) {
        result = { '$or': conds }
      } else {
        result = conds[0];
      }

      debug('resulting condition', result);

      return {
        allow: rule.allow,
        query: result
      };
    });
    debug('RESULTING QUERIES SET', queriesSet);

    // Lets merge all queries set to single query
    let mergedQuery = {};

    // TODO: use bind instead
    let self = this;
    let toQuery = function(next, arr) {
      let item = arr.pop();

      let key = '$or';
      let query = item.query;
      if (!item.allow) {
        key = '$and';
        query = self.invertMongoQuery(item.query);
      }

      // If last item
      if (!arr.length) {
        Object.assign(next, query);
        return;
      }

      let newNext = {};
      next[key] =[newNext, query];

      toQuery(newNext, arr);
    };

    toQuery(mergedQuery, queriesSet.slice(0));

    debug('mergedQuery', mergedQuery);

    return mergedQuery;
  }

  /**
   * Invert mongodb query. Not all queries are supported.
   * One should avoid specifying a condition with { "allow": false }
   * as automatic inversion might give unexpected result
   *
   * TODO: move to separate npm module
   * TODO: ( { qty: { $exists: true, $nin: [ 5, 15 ] } } )
   * TODO: invert $not
   *
   * @param sourceQuery
   */
  invertMongoQuery(sourceQuery) {
    let invertedQuery = {};

    for (let key of Object.keys(sourceQuery)) {
      //debug('iterate key', key);
      let val = sourceQuery[key];

      if (key.startsWith('$')) {
        if (key == '$and') {
          // Invert every item
          // wrap into $nor
          invertedQuery['$nor'] = [{
            '$and': val
          }];
        } else if (key == '$or') {
          // change to $nor
          invertedQuery['$nor'] = val;
        } else {
          throw new Error('Can not invert query. Unsupported top-level operator');
        }


        continue;
      }


      // Operator replace map
      /*
        Note that: { $not: { $gt: 1.99 } } is different from the $lte operator

        db.inventory.find( { price: { $not: { $gt: 1.99 } } } )
        This query will select all documents in the inventory collection where:

        the price field value is less than or equal to 1.99 or
        the price field does not exist

        This way it is better to avoid $not
       */
      let replaceMap = {
        '$in': '$nin',
        '$nin': '$in',
        '$gt': '$lte',
        '$lte': '$gt',
        '$lt': '$gte',
        '$gte': '$lt',
        '$ne': '$eq'
      };

      // Check if field value is expression
      if (isPlainObject(val) && Object.keys(val)[0].startsWith('$')) {
        let operator = Object.keys(val)[0];
        // If possible, try to replace operator
        if (replaceMap[operator]) {
          invertedQuery[key] = {
            [replaceMap[operator]]: val[operator]
          };
          continue;
        }

        // TODO: can we do more? Wrap into $not for example
        throw new Error('Can not invert query. Unsupported operators', sourceQuery);
      } else {
        // Invert boolean
        // If we will use $ne here then empty values could unexpectedly match
        if (typeof(val) === "boolean") {
          invertedQuery[key] = !val;
          continue;
        }

        // For other values use $ne to invert value
        invertedQuery[key] = { '$ne': val };
      }
    }

    return invertedQuery;
  }

  /**
   * Left only rules that matches current static roles or all possible dynamic roles
   *
   * @deprecated
   *
   * @param ctx
   * @returns {Function}
   */
  isRuleHasPossibleRole(ctx) {
    return (function(rule) {
      debug('isRuleHasPossibleRole', rule);

      // TODO: what to do with owner role
      // TODO: what to do with multiple roels
      let dynamicRoles = !this.isDependentRule(rule)
        ? this.getDynamicRoleNames(ctx)
        : this.getDependentModel(rule).getDynamicRoleNames(ctx);

      debug('dynamic roles', dynamicRoles);
      let roles = dynamicRoles.concat(this.getStaticRoles(ctx));

      debug('possible roles', roles);

      // TODO we have to trim impossible roles
      // and if roles become empty - we are deleting this Rule completely
      //
      if (!~rule.roles.indexOf('*') && !rule.roles.filter(r => ~roles.indexOf(r)).length) {
        debug('false');
        return false;
      }

      debug('true');

      return true;
    }).bind(this);
  }

  /**
   * Remove impossible roles
   *
   * @param ctx
   * @param sourceRule
   */
  removeImpossibleRoles(ctx, sourceRule) {
    debug('remove impossible roles, sourceRule:', sourceRule);

    let rule = clone(sourceRule);

    // 1. Get possible roles:
    // all possible (defined) dynamic roles + static roles of current user

    // Get dynamic roles for model from current model or related
    let dynamicRoles = this.isDependentRule(rule)
      ? this.getDependentModel(rule).getDynamicRoleNames(ctx)
      : this.getDynamicRoleNames(ctx);
    debug('dynamicRoles', dynamicRoles);

    // Get static roles that based on currentUser stored in context
    let staticRoles = this.getStaticRoles(ctx);
    debug('staticRoles', staticRoles);

    // If rule * exists - left only it
    if (~rule.roles.indexOf('*')) {
      rule.roles = ['*'];
      debug('Match * role, result', rule);
      return rule;
    }

    // Try to match static roles
    let matchedStaticRoles = this.getMatchedRoles(rule, staticRoles);
    if (matchedStaticRoles.length) {
      // If static roles matched - left only one matched static role
      // This way we just trim redundant roles
      rule.roles = [matchedStaticRoles[0]];

      debug('Match static roles, result', rule);

      return rule;
    }

    // no static roles are matched
    // theoretically only dynamic roles left
    let matchedDynamicRoles = this.getMatchedRoles(rule, dynamicRoles);
    if (matchedDynamicRoles.length) {
      // left only dynamic roles
      // TODO: this is probably redundant
      // TODO: A invalid roles should be filtered on initialization step
      rule.roles = matchedDynamicRoles;
      debug('Match dynamic roles, result', rule);
      return rule;
    }

    rule.roles = [];

    debug('Not match any role, result', rule);

    return rule;
  }


  /**
   * Set deferred property of the rule
   * Deferred indicates if rule could be applied immediately or
   * requires to get some additional data
   *
   * @param staticRoles
   * @param sourceRule
   */
  markAsDeferred(staticRoles, sourceRule) {

    // Rule might be deferred or static
    // Rule is deferred if it has scope or it has dynamic role
    // Otherwise rule is static

    // The method assumes that all rules are filtered from redundant or incorrect values
    // If rule has scope or not match static rule or *

    debug('mark as deferred', sourceRule);
    let rule = clone(sourceRule);

    if (rule.scope || (!~rule.roles.indexOf('*') && !this.isRuleMatchRoles(rule, staticRoles))) {
      debug('rule is deferred');
      rule.deferred = true;
    } else {
      debug('rule is static');
      rule.deferred = false;
    }

    return rule;
  }

  /**
   * Check if rule match any of given roles
   *
   * @param rule
   * @param roles
   * @returns {boolean}
   */
  isRuleMatchRoles(rule, roles) {
    return !!rule.roles.filter(r => ~roles.indexOf(r)).length;
  }


  /**
   * Match rule with "roles" and return array of matched rule roles
   *
   * @param rule
   * @param roles
   * @returns {Array.<T>}
   */
  getMatchedRoles(rule, roles) {
    return rule.roles.filter(r => ~roles.indexOf(r));
  }

  /**
   * Applies ACL rules on properties
   * Might be deferred
   * TODO: cond function could return static value - e.g. false, or true.
   * TODO: if, for example, user is anonymous
   * TODO: think later how it should be implemented
   *
   * @returns {Promise.<void>}
   */
  async buildAccessMap(acls, ctx) {
    // getDeferredMap
    // think later what name of the function and args are better
    debug('Applying rules on props');

    // Initialize the access map of properties
    // By default, everything is allowed
    let accessMap = {};
    // TODO: think - should we include relation properties
    // TODO: default behaviour - no restrictions
    Object.keys(this.schema.properties).forEach(field => {
      accessMap[field] = true;
    });

    debug('Iterating filtered acls');

    // New algorithm
    let staticRoles = this.getStaticRoles(ctx);
    //let dynamicRoles = this.getDynamicRoles(ctx);
    for (let [index, rule] of acls.entries()) {
      debug('iterating rule', index, rule);

      let applyValue = rule.allow;

      // deferred - helper property that set earlier
      if (rule.deferred === true) {
        applyValue = clone(rule);
        // Set temporary id in order to simplify further calculations
        applyValue.id = index;
      }

      debug('applyValue:', applyValue);

      // TODO: quick fix. move it to initialization step
      if (!rule.properties)  {
        rule.properties = ['*'];
      }

      for (let prop of rule.properties) {
        debug('iterating rule properties');
        if (prop == '*') {
          for (let prop of Object.keys(accessMap)) {
            accessMap[prop] = this.getNewApplyValue(accessMap[prop], applyValue);
          }
          break;
        }

        // We have to check current value
        accessMap[prop] = this.getNewApplyValue(accessMap[prop], applyValue)
      }

    }

    debug('resulting accessMap', accessMap);

    return accessMap;
  }

  /**
   * Get new apply value
   *
   * @param prevValue
   * @param applyValue
   */
  getNewApplyValue(prevValue, applyValue) {
    debug('getNewApplyValue', prevValue, applyValue);
    // Algorithm that applies value on access map property

    // If strict value just apply as is
    if (typeof(applyValue) === "boolean") {
      debug('strict boolean');
      return applyValue;
    }

    // If value with conditions lets check previous value
    // If previous value is also condition then append this condition
    if (Array.isArray(prevValue)) {
      debug('append');
      prevValue.push(applyValue);
      return prevValue;
    }

    // If previous value is boolean
    // Replace it with apply value only if it invert allow value
    if (prevValue !== applyValue.allow) {
      debug('prevValue is different from deferred value - set deferred');
      return [applyValue];
    }

    // Otherwise return prev value
    debug('deferred value does not override prev value - keep prev value');
    return prevValue;
  }

  /**
   * Filters ACL rules by action
   *
   * @param action
   * @returns {Function}
   */
  isRuleMatchAction(action) {
    return function(rule) {
      debug('isRuleMatchAction', action, rule);
      if (!~rule.actions.indexOf('*') && !~rule.actions.indexOf(action)) {
        debug('false');
        return false;
      }

      debug('true');
      return true;
    }
  }


  /**
   * Check if rule depends on another model
   *
   * @param rule
   * @returns {boolean}
   */
  isDependentRule(rule) {
    debug('isDependentRule');
    return !!rule.checkRelation;
  }

  /**
   * Get model that rule depends on
   * @param rule
   * @returns {*}
   */
  getDependentModel(rule) {
    debug('getDependentModel');
    return Spikenail.models[rule.checkRelation];
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
      this.handleACL,
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
      this.handleACL,
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
      this.handleACL,
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
    opts.action = ACTION_CREATE;
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
    opts.action = ACTION_UPDATE;
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
    opts.action = ACTION_REMOVE;
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
   * Entrypoint for resolving single item
   *
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {{}}
   */
  async resolveOne(options, _, args, ctx) {
    return this.resolveItem(options, _, args, ctx);
  }

  /**
   * Entrypoint for resolving belongsTo relation
   *
   * @param options
   * @param _
   * @param args
   * @param ctx
   */
  resolveBelongsTo(options, _, args, ctx) {
    // TODO
  }

  /**
   * Entrypoint for resolving allItems
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
    // Specifying additional condition
    options.query = {
      [options.property.foreignKey]: _._id
    };

    options.actionType = 'hasMany';

    debug('resolveHasMany', options);

    return (await this.processChain(this.getReadChain(), ...arguments)).result;
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