const debug = require('debug')('spikenail:Spikenail');
const ro = require('debug')('ro');

import Koa from 'koa';
import convert from 'koa-convert';

import { graphqlKoa, graphiqlKoa } from 'graphql-server-koa';

import koaRouter from 'koa-router';
import cors from 'koa-cors';
import koaBody from 'koa-bodyparser';

import mongoose from 'mongoose';
mongoose.Promise = global.Promise;

import authMiddleware from './middlewares/auth';

import pluralize from 'pluralize';
import capitalize from 'lodash.capitalize';

import { EventEmitter } from 'events';

import requireAll from 'require-all';

import { withFilter } from 'graphql-subscriptions';

import { createServer } from 'http';
import { SubscriptionServer } from 'subscriptions-transport-ws';
import { execute, subscribe } from 'graphql';

const url = require('url');

import AuthService from './services/AuthService';


import {
  GraphQLObjectType,
  GraphQLList,
  GraphQLString,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLFloat,
  GraphQLID,
  GraphQLSchema,
  GraphQLNonNull,
  getNullableType
} from 'graphql';

import GraphQLJSON from 'graphql-type-json';

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

import MutationError from './types/MutationError';
import PageInfo from './types/PageInfo';

/**
 * Spikenail server
 */
class Spikenail extends EventEmitter {

  /**
   * @constructor
   */
  constructor(config) {
    super();

    // Remove memory-leak warning about max listeners.
    this.setMaxListeners(0);
  }

  /**
   * Start the server
   */
  async start() {
    console.log('Starting the server...');
    try {
      const app = new Koa();
      let router = koaRouter();

      // Load models
      this.models = await this.loadModels();

      // Generate and expose graphql schema
      if (Object.keys(this.models).length) {
        this.graphqlSchema = this.createGraphqlSchema(this.models);

        router.all('/graphql',
          (context, next) => graphqlKoa({
            schema: this.graphqlSchema,
            context,
          })(context, next),
        );

        router.get('/graphiql', (context, next) => {
          return graphiqlKoa({
            endpointURL: '/graphql',
            subscriptionsEndpoint: `ws://localhost:8000/graphql?auth_token=` + context.request.query.auth_token
          })(context, next)
        }
        );

      } else {
        debug('No models loaded');
      }

      app
        .use(koaBody())
        .use(convert(cors()))
        .use(router.allowedMethods())
        .use(authMiddleware())
        .use(router.routes());

      this.app = app;

      await this.boot();

      this.server = await this.app.listen(5000);
      console.log('Server is listening on port 5000');

      if (this.pubsub) {
        // Start the websocket server
        // Create WebSocket listener server
        const websocketServer = createServer((request, response) => {
          response.writeHead(404);
          response.end();
        });

        // Bind it to port and start listening
        websocketServer.listen(8000, () => console.log(
          `Websocket Server is now running on http://localhost:8000`
        ));


        const subscriptionServer = SubscriptionServer.create(
          {
            schema: this.graphqlSchema,
            execute,
            subscribe,
            onConnect: async function(payload, socket) {
              let location = url.parse(socket.upgradeReq.url, true);
              let authToken = location.query.auth_token;

              if (!authToken) {
                return {};
              }

              let currentUser = await AuthService.authenticate(authToken);

              if (currentUser) {
                return {
                  currentUser: currentUser
                }
              }
            }
          },
          {
            server: websocketServer,
            path: '/graphql',
          },
        );

        this.subscriptionServer = subscriptionServer;
      }

    } catch (err) {
      console.error(err);
    }
  }

  /**
   * Load models
   *
   * @returns {{}}
   */
  loadModels() {
    const appDir = process.cwd();
    debug('loadModels');

    let models = requireAll({
      dirname: appDir + '/models'
    });

    let modelsMap = {};
    for (let className of Object.keys(models)) {

      if (!models[className].default) {
        continue;
      }

      modelsMap[models[className].default.getName()] = models[className].default;
    }

    return modelsMap;
  }

  /**
   * Bootstrap the application
   */
  async boot() {
    const appDir = process.cwd();
    debug('Booting the app', appDir);

    // Boot data sources
    let sources;
    try {
        sources = require(appDir + '/config/sources.js');
        await this.bootDataSources(sources);
    } catch (e) {
      if (e instanceof Error && e.code === "MODULE_NOT_FOUND") {
          debug('Can not load config/sources.js')
      } else {
        console.error(e);
        throw e;
      }
    }

    await this.bootPubSub();

  }

  /**
   * Boot pubsub engine
   *
   * @returns {Promise.<void>}
   */
  async bootPubSub() {
    const appDir = process.cwd();
    try {
      let config = require(appDir + '/config/pubsub.js').default.pubsub;
      let pubsub = require(appDir + '/node_modules/spikenail-pubsub-' + config.adapter).PubSub;
      this.pubsub = new pubsub(config.connection || {});
    } catch (e) {
      console.error(e);
      debug('Can not load config/pubsub.js');
    }
  }

  /**
   * Boot data sources
   *
   * @param sources
   */
  bootDataSources(sources) {
    // TODO remove double default
    // TODO: only one data source is currently supported
    return mongoose.connect(sources.default.default.connectionString, { server: { socketOptions: { keepAlive: 1 } } });
  }

  /**
   * Creates root query from models
   * TODO: move all graphql functions into another module
   *
   * @param models
   */
  createGraphqlSchema(models) {
    debug('createGraphqlSchema');

    let fields = {};

    let modelTypes = {};
    let modelFields = {};

    //modelTypes['pageInfo'] = PageInfo;

    // Relay node field support
    const {nodeInterface, nodeField} = nodeDefinitions(
      (globalId, ctx) => {
        let {type, id} = fromGlobalId(globalId);

        let params = {
          id: id
        };

        // TODO: not sure that these are correct arguments
        return this.models[type].resolveOne(params, null, [], ctx);
      },
      (obj) => {
        return modelTypes[obj.constructor.modelName] || null;
      }
    );

    // Root query
    let queryFields = {
      node: nodeField
    };

    // Preparing model types
    // The way to resolve circular references in graphql
    // Determine viewer model if exists
    let viewerModel;
    for (const className of Object.keys(models)) {

      let model = models[className];

      // Ignore empty model files
      if (!model.getName) {
        continue;
      }

      // Lets determine viewer model
      // TODO: not sure if we actually need a flag for it. It is easier to always use model named User as viewer
      if (model.isViewer()) {
        viewerModel = model;
      }

      let name = model.getName();

      // Create placeholder for fields
      modelFields[name] = {};

      modelTypes[name] = new GraphQLObjectType({
        name: name,
        fields: function() {
          return modelFields[name];
        },
        interfaces: [nodeInterface]
      });
    }

    let viewerFields = {
      id: globalIdField('user')
    };

    // Add id and current user fields if User model exists
    if (viewerModel) {
      //viewerFields.id = globalIdField('user');
      viewerFields.user = {
        type: modelTypes.user,
        resolve: function(_, args) {
          return viewerModel.resolveViewer({}, ...arguments);
        }
      }
    }

    // Now fill modelFields and viewer fields
    for (const className of Object.keys(models)) {

      let model = models[className];

      // Ignore empty model files
      if (!model.getName) {
        continue;
      }

      let name = model.getName();

      modelFields[name] = this.schemaToGraphqlFields(model.schema, modelTypes);

      let graphqlType = modelTypes[model.getName()];

      viewerFields['all' + capitalize(pluralize(model.getName()))] = this.wrapTypeIntoConnection(graphqlType, 'viewer');

      queryFields['get' + capitalize(model.getName())] = {
        type: graphqlType,
        args: model.getGraphqlItemArgs(),
        resolve: (function(_, args) {
          let params = {};

          if (args.id) {
            params.id = fromGlobalId(args.id).id;
          }

          return model.resolveOne(params, ...arguments);
        }).bind(this)
      };
    }

    let viewer;
    if (Object.keys(viewerFields).length) {
      viewer = {
        type: new GraphQLObjectType({
          name: 'viewer',
          fields: function() { return viewerFields },
          interfaces: [nodeInterface]
        }),
        resolve: function(_, args) {
          return {};
          //return viewerModel.resolveViewer({}, ...arguments);
        }
      };
    }

    // Create mutations and subscriptions
    let subscriptionFields = {};
    let mutationFields = {};
    for (const className of Object.keys(models)) {

      let model = models[className];

      // Ignore empty model files
      if (!model.getName) {
        continue;
      }

      // Mutations
      mutationFields = Object.assign(
        mutationFields,
        this.buildCRUDMutation('create', model, modelTypes, viewer),
        this.buildCRUDMutation('update', model, modelTypes, viewer),
        this.buildCRUDMutation('remove', model, modelTypes, viewer)
      );

      subscriptionFields = Object.assign(
        subscriptionFields,
        this.buildSubscription(model, modelTypes)
      );
    }

    // Lets create and add mutation
    let RootMutation = new GraphQLObjectType({
      name: 'Mutation',
      fields: mutationFields
    });


    // Add viewer if defined
    if (viewer) {
      // TODO: viewer should extend node field
      queryFields.viewer = viewer;
    } else {
      debug('no viewer defined');
    }

    let RootQuery = new GraphQLObjectType({
      name: 'Query',
      fields: () => (queryFields)
    });

    let RootSubscription = new GraphQLObjectType({
      name: 'Subscription',
      fields: () => (subscriptionFields)
    });

    let finalSchema = new GraphQLSchema({
      query: RootQuery,
      mutation: RootMutation,
      subscription: RootSubscription
    });

    return finalSchema;
  }

  /**
   * Build subscription type
   * TODO: socket does not pass auth token so we does not have auth context
   *
   * @param model
   * @param modelTypes
   * @returns {{}}
   */
  buildSubscription(model, modelTypes) {
    let subscriptionName = 'subscribeTo' + capitalize(model.getName());

    // TODO: workaround for passing ctx and other args
    const filtered = (asyncIteratorFn, filter) => withFilter(
      asyncIteratorFn,
      filter,
    );

    let subscription = {
      type: new GraphQLObjectType({
        name: subscriptionName,
        fields: () => ({
          mutation: { type: GraphQLString },
          node: {
            type: modelTypes[model.getName()]
          }
        })
      }),
      resolve: (function(_, args) {
        let params = {};
        return model.resolveSubscription(params, ...arguments);
      }).bind(this),
      args: model.getGraphqlSubscriptionArgs(),
      subscribe: (_, args, ctx, info) => filtered(
        model.subscribe.bind(model, _, args, ctx, info),
        (payload, variables) => {
          return model.messagesFilter(payload, args, ctx);
        }
      )()
    };

    return {
      [subscriptionName]: subscription
    }
  }

  /**
   * Build CRUD mutation
   *
   * @param action
   * @param model
   * @param types
   * @param viewer May not exists
   * @returns {{}}
   */
  buildCRUDMutation(action, model, types, viewer) {
    const mutationName = action + capitalize(model.getName());
    let mutationFields = this.schemaToMutationFields(model.schema);

    // TODO: use or primary flag or restrict such fields through acl
    if (action == 'create') {
      delete mutationFields['id'];
    }

    // TODO: removing userId from input fields as you can not change it
    // TODO: Otherwise we need to make that field nullable or it will throw an error
    //delete mutationFields['userId'];

    // Resolvers
    let successResolver;
    if (action == 'create' || action == 'update') {
      successResolver = function({ result }) {
        // TODO: probably
        if (!result || !result.id) {
          return null;
        }

        // TODO: handle no id case
        return model.resolveOne({ id: result.id }, ...arguments);
      }
    }

    let config = {
      name: capitalize(mutationName),
      inputFields: mutationFields,

      outputFields: {
        //viewer: viewer,
        errors: {
          type: new GraphQLList(MutationError),
          resolve: function({ errors }) {
            if (errors && errors.length) {
              return errors;
            }

            return null;
          }
        },
        [model.getName()]: {
          type: types[model.getName()],
          resolve: successResolver
        }
      },
      mutateAndGetPayload: function(input) {
        return model[`mutateAndGetPayload${capitalize(action)}`]({}, ...arguments)
      }
    };

    if (viewer) {
      config.outputFields.viewer = viewer;
    }

    if (action == 'remove') {
      config.outputFields.removedId = {
        type: GraphQLString,
        resolve: ({ result }) => {
          // TODO: looks like workaround
          return result ? toGlobalId(model.getName(), result.id) : null
        }
      };

      // TODO: not sure
      delete config.outputFields[model.getName()];
    }

    let mutation = mutationWithClientMutationId(config);

    return {
      [mutationName]: mutation
    }
  }

  /**
   * Wrap type into relay connection
   *
   * @param type
   * @param parentName
   * @param resolve
   * @returns {{type, args: ({first, last, after, before, filter}|*), resolve: (function(this:Spikenail))}}
   */
  wrapTypeIntoConnection(type, parentName, resolve) {
    let name = type.name;
    // Relay (edges behaviour)
    let Edge = new GraphQLObjectType({
      name: parentName + '_' + name + 'Edge',
      fields: function() {
        return {
          cursor: {
            type: new GraphQLNonNull(GraphQLString)
          },
          node: {
            type: type
          }
        }
      }
    });

    return {
      type: new GraphQLObjectType({
        // We adding schema.name to avoid same conection from two different models
        name: parentName + '_' + name + 'Connection',
        fields: function () {
          return {
            edges: {
              type: new GraphQLList(Edge)
            },
            pageInfo: {
              type: PageInfo
            }
          }
        }
      }),
      args: this.models[name].getGraphqlListArgs(),
      resolve: (function(_, args) {
        return this.models[name].resolveAll({
          //property: field
        }, ...arguments);
      }).bind(this)
    };
  }

  /**
   * Converts model schema to graphql type's fields
   *
   * @private
   *
   * @param schema
   * @param types Other available types
   */
  schemaToGraphqlFields(schema, types) {

    // TODO: support auto createdat, updatedat

    let fields = {};

    for (let prop of Object.keys(schema.publicProperties)) {
      let field = schema.publicProperties[prop];

      // Handle relation
      if (field.relation) {

        let type = types[field.ref];

        // Non relay behaviour
        // TODO: ability to select behaviour
        //if (field.relation == 'hasMany') {
        //  type = new GraphQLList(type);
        //}

        if (field.relation == 'hasMany') {

          // Relay (edges behaviour)
          let Edge = new GraphQLObjectType({
            // We adding schema.name to avoid same connection from two different models
            name: schema.name + '_' + prop + 'Edge',
            fields: function() {
              return {
                cursor: {
                  type: new GraphQLNonNull(GraphQLString)
                },
                node: {
                  type: type
                }
              }
            }
          });

          fields[prop] = {
            type: new GraphQLObjectType({
              // We adding schema.name to avoid same conection from two different models
              name: schema.name + '_' + prop + 'Connection',
              fields: function () {
                return {
                  edges: {
                    type: new GraphQLList(Edge)
                  },
                  pageInfo: {
                    type: PageInfo
                  }
                }
              }
            }),
            args: this.models[field.ref].getGraphqlListArgs(),
            resolve: (async function(_, args, ctx) {
              ro('================> HAs many Resolve', schema.name, field);
              let params = {
                options: {
                  property: field,
                  parentModelName: schema.name
                },
                arguments: [...arguments]
              };

              // TODO: we should not use batching if any of pagination params passed

              // check if pagination params passed
              // TODO: hasPaginationArgs
              if (args.first || args.after) {

                return this.models[field.ref].resolveHasMany({
                  property: field
                }, ...arguments);
              }

              return await this.models[field.ref].getDataLoaderFromContext(ctx, 'hasMany').load(params);

            }).bind(this)
          };
        }

        if (field.relation === 'belongsTo') {
          fields[prop] = {
            type: type,
            resolve: (async function(_, args, ctx) {

              let params = {
                options: {
                  property: field
                },
                arguments: [...arguments]
              };

              return await this.models[field.ref].getDataLoaderFromContext(ctx, 'belongsTo').load(params);

            }).bind(this)
          }
        }

        continue;
      }

      fields[prop] = this.fieldToGraphqlType(prop, field, schema);

      // Add custom resolver if defined
      if (schema.resolvers && schema.resolvers[prop]) {
        fields[prop].resolve = schema.resolvers[prop].bind(this);
      }
    }

    return fields;
  }

  /**
   * TODO: its is very similar to schema to graphql fields
   */
  schemaToMutationFields(schema) {
    let fields = {};

    for (let prop of Object.keys(schema.publicProperties)) {
      let field = schema.publicProperties[prop];

      // Skip relations for now
      if (field.relation) {
        continue;
      }

      // Skip readOnly fields
      if (field.readOnly) {
        continue;
      }

      fields[prop] = this.fieldToGraphqlType(prop, field, schema);

      // TODO: quickfix. As globalId has resolver, we need to strip it to avoid:
      // TODO: "field type has a resolve property, but Input Types cannot define resolvers."
      if (fields[prop].resolve) {
        delete fields[prop].resolve;
      }

      // Just strip all not null for now
      // TODO: quickfix ? don't
      fields[prop].type = getNullableType(fields[prop].type);
    }

    return fields;
  }

  /**
   * Check if field is primary key
   *
   * @param field
   * @param name
   * @returns {boolean}
   */
  isPrimaryKey(field, name) {
    return name === 'id';
    // TODO: add keys configuration
  }

  /**
   * Convert type to graphql type
   *
   * @param prop
   * @param field
   * @param schema
   * @returns {*}
   */
  fieldToGraphqlType(prop, field, schema) {
    let type = field.type;

    switch(type) {
      case 'id':
        if (field.foreignKeyFor) {
          return globalIdField(field.foreignKeyFor, function(obj) { return obj[prop] });
        }

        // TODO: workaround
        if (schema.name == 'viewer') {
          return globalIdField('user');
        }

        return globalIdField(schema.name);
      case String:
        return { type: GraphQLString };
      case Boolean:
        return { type: GraphQLBoolean };
      case Number:
        return { type: GraphQLInt }; // TODO: there is two separate types in graphql
      case 'Float':
        return { type: GraphQLFloat };
      case Object:
        return { type: GraphQLJSON };
      // TODO: not sure
      case Array:
        return { type: GraphQLJSON };

      default:
        return { type: GraphQLString };
    }

  }
}

export default new Spikenail();