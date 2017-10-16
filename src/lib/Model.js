const debug = require('debug')('spikenail:Model');
const hl = require('debug')('hl');
const hm = require('debug')('hm');
const ro = require('debug')('ro');

const clone = require('lodash.clone');
const isPlainObject = require('lodash.isplainobject');

import pluralize from 'pluralize';
import capitalize from 'lodash.capitalize';

const md5 = require('md5');

const sift = require('sift');

const path = require('path');

import mongoose from 'mongoose';

import ValidationService from './services/Validation/ValidationService';

import MongoAccessMap from './AccessMap/MongoAccessMap';

import Spikenail from './Spikenail';

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
  async afterCreate(result, next, opts, input, ctx) {
    next();
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
  afterUpdate(result, next) {
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
  afterRemove(result, next, opts, input, ctx) {
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
   * Handle read one ACL
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
    next();
  }

  /**
   * Apply access map to data
   * TODO: use this method in postHandleReadAllACL
   *
   * @param accessMap calculated accessMap
   * @param data
   */
  applyAccessMapToData(accessMap, data) {}

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
   */
  async postHandleReadAllACL(result, next, options, _, args, ctx) {
    next();
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
   *
   * @param ctx
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
    let middlewares = [
      this.handleCreateACL,
      this.validate,
      this.beforeCreate,
      this.processCreate,
      this.afterCreate
    ];

    if (Spikenail.pubsub) {
      middlewares.push(this.publishCreate)
    }

    return middlewares;
  }

  /**
   * Update chain
   *
   * @returns {*[]}
   */
  getUpdateChain() {

    let middlewares = [
      this.handleUpdateACL,
      this.validate,
      this.beforeUpdate,
      this.processUpdate,
      this.afterUpdate
    ];

    if (Spikenail.pubsub) {
      middlewares.push(this.publishUpdate)
    }

    return middlewares;
  }

  /**
   * Remove chain
   *
   * @returns {*[]}
   */
  getRemoveChain() {
    let middlewares = [
      this.handleRemoveACL,
      //this.validate, TODO: not needed?
      this.beforeRemove,
      this.processRemove,
      this.afterRemove
    ];

    if (Spikenail.pubsub) {
      middlewares.push(this.publishRemove)
    }

    return middlewares;
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
   * Subscription args
   *
   * @returns {{filter: {name: string, type: *}}}
   */
  getGraphqlSubscriptionArgs() {
    return {
      // Custom filter
      filter: {
        name: 'filter',
        type: GraphQLJSON
      },
      // id: {
      //   name: 'id',
      //   type: GraphQLString
      // }
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
  async resolveList(params, _, args, ctx) {}

  /**
   * Query
   *
   * @param options
   * @param _
   * @param args
   */
  async query(options = {}, _, args) {}

  /**
   * Resolve single item
   *
   * @returns {{}}
   */
  async resolveItem(params, _, args, ctx) {}

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
  async resolveHasMany(options, _, args, ctx) {}

  /**
   * Entrypoint for resolving belongsTo relation
   *
   * @param options
   * @param _
   * @param args
   * @param ctx
   */
  async resolveBelongsTo(options, _, args, ctx) {}

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

  /**
   * Publish update middleware
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async publishUpdate(result, next, options, _, args, ctx) {
    next();
  }

  /**
   * Publish create middleware
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async publishCreate(result, next, options, _, args, ctx) {
    next();
  }

  /**
   * Publish create middleware
   *
   * @param result
   * @param next
   * @param options
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async publishRemove(result, next, options, _, args, ctx) {
    next();
  }

  /**
   * Subscribe
   *
   * @param _
   * @param args
   * @param context
   * @param info
   */
  async subscribe(_, args, context, info) {}

  /**
   * PubSub Messages filter, including ACL check. Return true if user can receive message and false if not
   *
   * @param payload
   * @param args
   * @param ctx
   */
  messagesFilter(payload, args, ctx) {
    return true;
  }

  /**
   * Resolve data that requested by subscribe query to be returned back
   *
   * @param params
   * @param _
   * @param args
   * @param ctx
   * @returns {Promise.<void>}
   */
  async resolveSubscription(params, _, args, ctx) {}

  /**
   * Get topics
   * TODO: we need to actively use cache in order to avoid fetching same items twice
   *
   * @param result
   *
   * @returns {Promise.<void>}
   */
  async getTopics(result) {
    // TODO: always add scope to topics in order to allow subscribing */list/1 even if it is under some categories

    let topics = [];

    let maxTopicDepth = this.schema.maxTopicDepth;

    let depth = 1;

    /**
     * Recursively build topics tree
     *
     * @param model
     * @param item
     * @param fetch if need to fetch item using item._id
     * @param parentName
     * @returns {Promise.<{}>}
     */
    let recursive = async function(model, item, fetch, parentName) {
      hm('recursive start');

      let tree = {};
      tree.name = [model.getName(), item._id]; // card, 123
      tree.topic = tree.name;

      // Concat topic
      if (parentName && parentName.length) {
        tree.topic = tree.topic.concat(parentName);
      }

      hm('tree name', tree.name);
      hm('item %o', item);

      // e.g. Card, item = resulting item
      let rels = model.getBelongsToRelations();

      // If no rels or reached max depth
      if (!rels.length || (depth === maxTopicDepth)) {
        hm('end of subtree');
        // TODO: push complete topic - as it is final target
        topics.push(tree.topic);
        return tree;
      }

      // Increase depth
      depth++;

      // If rels exists - create tree for each rel
      tree.children = [];
      for (let rel of rels) {
        hm('iterating rel %o', rel);
        let relModelName = rel.ref;
        let relModel = Spikenail.models[relModelName];

        let relItemId = item[rel.foreignKey];

        // Fetch item if needed. Only id of item could be provided
        hm('fetch', fetch, relItemId);
        if (fetch) {
          hm('need to fetch full item first', item._id);
          // Fetch full item
          let fullItem = await model.model.findById(
            new mongoose.Types.ObjectId(item._id)
          );

          hm('fullItem', fullItem);
          relItemId = fullItem[rel.foreignKey];

          hm('item fetched - new relItemId is', relItemId)
        }

        // If no foreign key specified
        if (!relItemId) {
          hm('no ID found using FK, go to next rel', item._id);
          continue;
        }

        // Create another tree
        let branch = {
          // modelName, id - e.g. list, 567
          name: [relModelName, relItemId]
        };

        // We are not fetching relItem here. May be not need it - if no rels.
        // Add nested branch
        branch = await recursive(relModel, { id: relItemId }, true, tree.topic);
        tree.children.push(branch);
      }

      return tree;
    };

    // TODO: for some reason we don't have full item at the beginning
    // TODD: we need to actively use cache in order to avoid fetching same items twice
    let tree = await recursive(this, result, false);

    hm('final topics tree %o', tree);

    hm('final topics %o', topics);

    return topics;
  }

  /**
   * Returns topic depth
   * @returns {*|number}
   */
  getTopicDepth() {
    return this.schema.topicDepth || 3;
  }

  /**
   * Get belongsTo relations of current model
   */
  getBelongsToRelations() {
    let rels = [];
    // TODO: optimize
    Object.values(this.publicProperties).forEach(prop => {
      if (prop.relation && prop.relation === 'belongsTo') {
        rels.push(prop);
      }
    });

    return rels;
  }

  /**
   * Get DataLoader from context. Create if not exists
   *
   * @param ctx
   * @param type
   */
  getDataLoaderFromContext(ctx, type) {}

}