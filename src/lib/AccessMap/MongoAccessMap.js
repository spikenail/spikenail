const debug = require('debug')('spikenail:MongoAccessMap');
const hl = require('debug')('hl');

const clone = require('lodash.clone');
const memoize = require('lodash.memoize');
const uuidV1 = require('uuid/v1');
const isPlainObject = require('lodash.isplainobject');

const md5 = require('md5');

const sift = require('sift');

import mongoose from 'mongoose';

import Spikenail from '../Spikenail';

/**
 * Access map for mongo models
 * TODO: extend base accessmap ?
 */
export default class MongoAccessMap {

  /**
   * Wraps model to build an access map
   *
   * @param model
   * @param ctx
   * @param options
   */
  constructor(model, ctx, options = {}, parentData) {
    debug(model.getName(), 'constructor', options);

    // TODO: filter by requested fields

    this.parentData = parentData; // TODO: deprecated?

    this.model = model;

    this.ctx = ctx;

    this.options = options;

    this.sourceACLs = clone(options.acls || model.getACLs());

    //let staticRoles = this.model.getStaticRoles(ctx);
    this.staticRoles = this.model.getStaticRoles(ctx);

    this.dynamicRoles = this.model.getRealDynamicRoles(ctx);
  }

  /**
   * Initialize map
   *
   * @returns {Promise.<void>}
   */
  async init() {
    debug('%s: initializing access map...', this.model.getName());

    // TODO: move this stuff on app initialization step
    // Handle rule injecting
    // TODO: deprecate injection stuff for now as looks like it is not very useful
    // let replaceMap = {};
    // for (let [index, rule] of this.sourceACLs.entries()) {
    //   let model = this.getInjectRelationModel(rule);
    //
    //   if (!model) {
    //     continue;
    //   }
    //
    //   hl('Injection model found:', model.getName());
    //
    //   // Create access map for the
    //   let opts = {};
    //   if (rule.action) {
    //     opts.action = rule.action;
    //   }
    //   let injectAccessMap = new MongoAccessMap(model, this.ctx, Object.assign(this.options, opts));
    //   await injectAccessMap.init();
    //
    //   // TODO: we have to throw an error if it has dependent rules as we are likely to unable handle this case for now
    //   // TODO: not sure about nested injection
    //   if (injectAccessMap.hasAtLeastOneTrueValue()) {
    //     hl('inject map has true value');
    //     // allow all
    //     replaceMap[index] = [{
    //       allow: true,
    //       fields: ['*'],
    //       roles: ['*'],
    //       actions: [this.options.action]
    //     }]
    //   } else if (injectAccessMap.isFails()) {
    //     hl('inject map fails');
    //     // build query
    //     replaceMap[index] = [{
    //       allow: false,
    //       fields: ['*'],
    //       roles: ['*'],
    //       actions: [this.options.action]
    //     }]
    //   } else {
    //     hl('accessmap is not determined');
    //     // Unable to instantly determine an access based on static roles
    //     // build query and use it as scope
    //
    //     // An issue - constructor is not async stuff
    //     let query = await injectAccessMap.getQuery();
    //     hl('inject query is %j', query);
    //     // TODO: we could possibly pick up the query of _id/or lists field only
    //     // TODO: means simplest query that will give us allow true value
    //
    //     // Synthetic rule where scope is query on dependent model
    //     replaceMap[index] = [{
    //       // Disallow everything by default
    //       allow: false,
    //       fields: ['*'],
    //       roles: ['*'],
    //       actions: [this.options.action]
    //     }, {
    //       // allow only in case we allow to access dependent relation
    //       allow: true,
    //       fields: ['*'],
    //       roles: ['*'],
    //       //test: 123,
    //       scope: function () { return query },
    //       actions: [this.options.action],
    //       checkRelation: model.getName()
    //     }]
    //   }
    // }
    //
    // debug('replaceMap', replaceMap);
    //
    // for (let index of Object.keys(replaceMap)) {
    //   let rules = replaceMap[index];
    //
    //   debug('replacing', rules);
    //
    //   // replace inject rule with rules
    //   this.sourceACLs.splice(index, 1, ...rules);
    //
    //   debug('after splice');
    // }
    //
    // hl('acls after injection %j', this.sourceACLs, this.sourceACLs);

    // Filter model acls according to specified options
    if (this.options.onlyDependentRules) {
      debug(this.model.getName(), 'access map is only for dependent rules');
      this.acls = this.sourceACLs.filter(rule => {
        return this.isDeferredRule(rule);
      })
    }

    // TODO: remove ctx from arguments - it is possible to access it by this.ctx
    this.acls = this.sourceACLs
      .filter(this.isRuleMatchAction(this.options.action)) // TODO: defaults? throw error?
      .map(this.removeImpossibleRoles.bind(this, this.ctx))
      .filter(rule => !!rule.roles.length)
      .map(this.filterRuleProperties.bind(this, this.options.properties))
      .filter(rule => !!rule);

    // Store flags to check what data has already built
    this.built = {};

    hl('%s: filtered acls: %o', this.model.getName(), this.acls);

    // Build map without queries
    this.accessMap = await this.buildAccessMap(this.acls);

    // Save some initial properties
    // TODO: not sure how to implement it better, so let's use quick fix for now
    // TODO: the issue is that we might apply some data and change actual rules
    // TODO: but we still need some metrics based on initial data to make some decisions
    this.initialProps = {};
    this.initialProps.hasDependentRules = this.hasDependentRules();
    this.initialProps.hasAtLeastOneTrueValue = this.hasAtLeastOneTrueValue();
  }

  /**
   * Resolve access map tree
   * TODO: handle non-skippable case
   *
   * @param data - store all fetched data
   * @param untrustedData
   * @returns {Promise.<void>}
   */
  async handleDependencies(data, untrustedData) {

    if (!data) {
      data = {};
    }

    if (!untrustedData) {
      untrustedData = {};
    }

    hl('%s: ------------ Handle access map dependencies', this.model.getName());
    hl('%s: data %o', this.model.getName(), data);
    hl('%s: untrustedData: %o', this.model.getName(), untrustedData);
    if (this.isFails()) {
      hl('%s: access map fails no need to handle deps', this.model.getName());
      // TODO: What is it?
      return;
    }

    let queriesMap = {};

    // TODO: ugly memoization workaround
    let processedRules = [];

    // TODO: memoization for same rules - don't process twice
    // Iterate properties of access map (e.g. id, name, email)
    for (let prop of Object.keys(this.accessMap)) {

      if (typeof this.accessMap[prop] === 'boolean') {
        continue;
      }

      hl('%s: prop: %s', this.model.getName(), prop);
      let rules = this.accessMap[prop].rules;

      // Rules iteration
      for (let rule of rules) {
        if (!this.isDependentRule(rule)) {
          continue;
        }

        if (~processedRules.indexOf(rule.id)) {
          hl('rule with id', rule.id, 'already processed');
          continue;
        }

        processedRules.push(rule.id);

        hl('%s: dep rule %o', this.model.getName(), rule);

        let query = null;

        // Check if untrusted data contains data of current model
        // If so prefetch dependencies and store it in untrusted data in order to optimize dependencies handling
        // by preventing fetching of all possible documents
        if (untrustedData[this.model.getName()]) {
          hl('%s: untrustedData exists for current model', this.model.getName());
          // Lets fetch all dependencies for the fk
          hl('%s rule %o', this.model.getName(), rule);

          let rel = this.model.publicProperties[rule.checkRelation.name];
          let fk = rel.foreignKey;
          //this.model.publicProperties[fk];
          //let id = untrustedData[this.model.getName()][fk];
          let ids = untrustedData[this.model.getName()].map(doc => doc[fk]);
          hl('%s: ids: %o', this.model.getName(), ids);

          let depModel = this.getDependentModel(rule);
          let untrustedItems = await depModel.model.find({ _id: { '$in': ids } });

          hl('%s: untrustedItems: %o', this.model.getName(), untrustedItems);

          untrustedData[depModel.getName()] = untrustedItems;
        }

        // check if possible to generate query
        // Check if it is last stage of tree
        // If no dependencies or already resolved
        if (!rule.accessMap.hasDependentRules() || rule.accessMap.isResolved) {
          hl('%s: access map (RESOLVED) - get query', this.model.getName());

          // TODO: duplicates
          query = await rule.accessMap.getQuery();

          hl('%s: push dep access map query %o:', this.model.getName(), query);
        } else {
          hl('%s: access map has dep rules (not last) - HANDLE DEPS', this.model.getName());
          // TODO: in some rare(?) cases there will be two parent query instead of one
          // If for access map that we are going to handle
          if (data && data[rule.accessMap.model.getName()]) {
            hl('%s: data exists for dependent accessMap %s: %o', this.model.getName(), rule.accessMap.model.getName(), data[rule.accessMap.model.getName()]);
          } else {
            hl('%s: parent data NOT exists for dependent access map %s. Handle deps:', this.model.getName(), rule.accessMap.model.getName());
            await rule.accessMap.handleDependencies(data, untrustedData);
            hl('%s: parentData as a result of handleDependencies: %o', this.model.getName(), data);
            query = await rule.accessMap.getQuery();
            hl('%s: new query after deps handling: %o', this.model.getName(), query);
          }
        }
        // Push query if generated
        // TODO only unique queries
        if (!queriesMap[rule.accessMap.model.getName()]) {
          queriesMap[rule.accessMap.model.getName()] = {
            queries: [],
            rules: []
          };
        }
        // TODO: Push only unique queries and rules (!) otherwise final query will be redundant or cond

        // TODO: diff are possible theoretically - diff actions
        if (query) {
          hl('%s: pushing query', this.model.getName());
          queriesMap[rule.accessMap.model.getName()].queries.push(query);
          queriesMap[rule.accessMap.model.getName()].rules.push(rule);
        } else {
          hl('%s: no query to push', this.model.getName())
        }
      }
    }

    // Using queries map fetch data and apply
    // iterate through dep models
    let depModelNames = Object.keys(queriesMap);

    hl('%s: depModelNames: %o', this.model.getName(), depModelNames);

    if (!depModelNames.length) {
      hl('%s: no deps', this.model.getName());
      return;
    }

    // Data map that is required for applyDependentData method
    let modelsMap = {};

    hl('%s: --- queriesMap %o', this.model.getName(), queriesMap);

    // Fetch data for dependent models
    for (let modelName of Object.keys(queriesMap)) {

      hl('%s: handle dep of: %s', this.model.getName(), modelName);

      let queries = queriesMap[modelName].queries;
      let rules = queriesMap[modelName].rules;

      // Make or query
      // TODO: remove redundant queries
      let query = this.queriesToOrQuery(queries);
      hl('%s: or query %o', this.model.getName(), query);

      // initialize
      if (!modelsMap[modelName]) {
        modelsMap[modelName] = {
          model: Spikenail.models[modelName]
        }
      }

      hl('%s: check that parent data instance of modelName', this.model.getName());

      // Check if data exists - don't fetch if so
      let fetchedData = [];
      if (data && data[modelName]) {
        hl('%s: parent data exists: %o', this.model.getName(), data[modelName]);
        fetchedData = data[modelName]
      } else {

        hl('%s: parent data NOT exists: %o', this.model.getName());

        // If untrusted data exists for the model, use it instead of real fetch
        if (untrustedData[modelName]) {
          hl('%s: untrusted data exists, sift instead of fetch', this.model.getName());
          fetchedData = sift(query, untrustedData[modelName]);
          hl('%s: sift result %o', this.model.getName(), fetchedData);
        } else {
          // Fetch if data not exists
          fetchedData = await Spikenail.models[modelName].model.find(query);
          hl('%s: fetched dep data %o', this.model.getName(), fetchedData);
        }
      }

      //debug('%s: final query: %o', this.model.getName(), query);
      modelsMap[modelName].data = fetchedData || [];
    }

    hl('%s: before applying data', this.model.getName());

    this.applyDependentData(modelsMap);

    hl('%s ---------- dependent data applied. resolved = true', this.model.getName());

    this.isResolved = true;
  }

  /**
   * Check that all values of access map are booleans
   */
  isPlain() {
    return Object.values(this.accessMap).every(val => { return typeof val === 'boolean' });
  }

  /**
   * Check if access map has some unresolved deps
   */
  isUnresolved() {

    debug('--- is unresolved %o', this.accessMap);

    return !this.isResolved;

    // return !Object.values(this.accessMap).every(val => {
    //   if (typeof val === 'boolean') {
    //     return true;
    //   }
    //
    //   for (let rule of val.rules) {
    //     if (rule.accessMap) {
    //       debug('--- rule has accessMap included %o', rule);
    //       return false;
    //     }
    //   }
    //
    //   return true;
    // });
  }

  /**
   * Convert array of queries to single AND query
   * @param queries
   * @returns {*}
   */
  queriesToAndQuery(queries) {
    if (queries.length > 1) {
      return {
        $and: queries
      }
    }

    return queries[0];
  }

  /**
   * Remove unmatched properties if specified
   *
   * @param properties
   * @param sourceRule
   * @returns {*}
   */
  filterRuleProperties(properties, sourceRule) {
    if (!properties) {
      return sourceRule;
    }

    let rule = clone(sourceRule);

    if (~rule.properties.indexOf('*')) {
      return rule;
    }

    rule.properties = rule.properties.filter(prop => ~properties.indexOf(prop));

    if (!rule.properties.length) {
      return null;
    }

    return rule;
  }

  /**
   * ??? not sure
   * @returns {*}
   */
  props() {
    return this.accessMap
  }

  /**
   * special rule that inject rules from the other model
   *
   * @param rule
   * @returns {boolean}
   */
  isInjectRule(rule) {
    return !!rule.test;
  }

  /**
   *
   * @param rule
   */
  getInjectRelation(rule) {
    if (!this.isInjectRule(rule)) {
      return null;
    }

    return this.model.schema.properties[rule.test];
  }

  /**
   * Get the model from which we need to inject rules
   *
   * @param rule
   * @returns {null}
   */
  getInjectRelationModel(rule) {
    let rel = this.getInjectRelation(rule);

    if (!rel) {
      return null;
    }

    return Spikenail.models[rel.ref];
  }

  /**
   * Get rules that need to inject
   *
   * @deprecated
   *
   * @param rule
   */
  getInjectionRules(rule) {
    debug('getInjectionRules for', rule);

    let model = this.getInjectRelationModel(rule);
    if (!model) {
      return null;
    }

    let acls = model.getACLs();

    if (!acls.length) {
      return null;
    }

    // Iterate through rules and adopt them
    acls = clone(acls);
    acls = acls.map(rule => {

      if (rule.checkRelation) {
        throw new Error('Unable to inject rules from model that have dependent rules');
      }

      if (this.isInjectRule(rule)) {
        throw new Error('Unable to inject rules from model that also inject rules');
      }

      rule.checkRelation = model.getName();

      return rule;
    });

    debug('injection rules found', acls);

    return acls;
  }

  /**
   * Get dependent access map for rule
   * TODO: memoize
   *
   * @param rule
   */
  // TODO refactoring
  async getDependentAccessMap(rule) {
    let depModel = this.getDependentModel(rule);

    let relationACL = rule.checkRelation;

    let acls = null;
    // Create new set of ACL rules for map if scope or roles defined
    if (relationACL.scope || relationACL.roles) {
      acls = [{
        allow: false,
        properties: ['*'],
        roles: ['*'],
        actions: ['*']
      }, {
        allow: true,
        properties: ['*'],
        actions:['*'],
        scope: relationACL.scope,
        roles: relationACL.roles || ['*'] // TODO: only dynamic roles make sense. Should we do something about this
      }];

      debug('%s ACLs for dep map overrided %o', this.model.getName(), acls);

    }
    // Build access map for dependent model
    // TODO: memoize
    // let opts = { roles: relationACL.roles };


    // Ability to specify for which action we are checking access relation
    // if (relationACL.action) {
    //   opts.action = relationACL.action;
    //   opts.properties = null;
    //   opts.onlyDependentRules = null;
    // }

    let opts = {
      action: relationACL.action,
      acls: acls
      // TODO: should we merge it with this.options?
    };

    let depAccessMap = new MongoAccessMap(
      depModel,
      this.ctx,
      opts
    );
    await depAccessMap.init();

    // TODO: so memoize by set of rules + model name?
    return depAccessMap;
  }

  /**
   * Returns access map with initial values
   * By default all is allowed
   */
  getInitialAccessMap() {
    // Initialize the access map of properties
    let accessMap = {};

    let initialProps = this.options.properties || Object.keys(this.model.schema.properties);
    initialProps.forEach(field => {
      // By default, everything is allowed
      accessMap[field] = true
    });

    return accessMap;
  }

  /**
   * Build access map tree
   *
   * @returns {Promise.<void>}
   */
  async buildAccessMap() {
    debug('%s: buildAccessMap, acls: %o', this.model.getName(), this.acls);
    let accessMap = this.getInitialAccessMap();

    // Build and simplify map without handling deps
    for (let rule of this.acls) {
      debug('%s processing rule: %o', this.model.getName(), rule);

      // lets set unique id to rule
      // We need it for memoization in order to avoid redundant processing as we clone rule objects
      // TODO: not sure it should be done here and not on some initialization step
      rule.id = uuidV1();

      // Determine the value to apply
      let applyValue = rule.allow;
      if (this.isDependentRule(rule) || this.isDeferredRule(rule)) {
        debug('%s: rule is deferred of dependent', this.model.getName());
        applyValue = rule;
      }

      // Determine to which properties to apply the rule
      let props = rule.properties;
      if (~rule.properties.indexOf('*')) {
        props = this.options.properties || Object.keys(accessMap);
      }

      // Applying
      for (let prop of props) {
        accessMap[prop] = clone(this.getNewApplyValue(clone(accessMap[prop]), clone(applyValue)));
      }
    }

    debug('%s: access map with applied rules, acls: %o', this.model.getName(), accessMap);

    // Build related access maps for deps that left
    // Try to simplify

    // Build dependent access map
    let getDependentAccessMap = memoize(this.getDependentAccessMap.bind(this), function(rule) {
      debug('memoize return key rule.id', rule.id);
      return rule.id;
    });

    let recalcProps = new Set();
    for (let prop of Object.keys(accessMap)) {
      let val = accessMap[prop];

      if (typeof val === 'boolean') {
        continue;
      }

      debug('%s: simplifying rules of prop %s', this.model.getName(), prop);

      // Iterate rules
      for (let [index, rule] of val.rules.entries()) {
        if (this.isDependentRule(rule)) {
          debug('%s found dep rule %o', this.model.getName(), rule);

          let depAccessMap = await getDependentAccessMap(rule);

          let newRuleVal = null;
          // Convert rule to boolean value if possible
          if (depAccessMap.hasAtLeastOneTrueValue()) {
            newRuleVal = rule.allow;

            // if rules is also deferred
            if (this.isDeferredRule(rule)) {
              debug('rule is also deferred');
              newRuleVal = clone(rule);
              delete newRuleVal.checkRelation
            }

            debug('%s dep map has one true value - resolve rule to %o', this.model.getName(), newRuleVal);
          } else if (depAccessMap.isFails()) {
            newRuleVal = !rule.allow;

            // if rules is also deferred
            if (this.isDeferredRule(rule)) {
              debug('rule is also deferred');
              newRuleVal = clone(rule);
              delete newRuleVal.checkRelation;
              newRuleVal.allow = !newRuleVal.allow;
            }

            debug('%s: dep map fails - resolve rule to %o', this.model.getName(), newRuleVal);
          } else {
            // just put access map to rule
            rule.accessMap = depAccessMap;
            debug('%s: cant resolve dep map in place', this.model.getName());
          }

          if (newRuleVal !== null) {
            debug('%s: -------\\\----replaced val at index %o - %o', this.model.getName(), index, newRuleVal);
            val.rules[index] = newRuleVal;
            recalcProps.add(prop);
          } else {
            debug('-----///----- no replace');
          }
        }
      }
    }

    debug('%s recalc props %o', this.model.getName(), recalcProps);

    if (!recalcProps.size) {
      debug('%s resulting accessMap %o', this.model.getName(), accessMap);
      hl('%s: resulting accessMap: %o', this.model.getName(), accessMap);
      return accessMap;
    }

    debug('...recalcing...');

    for (let prop of recalcProps) {
      debug('%s recalculating prop %s', this.model.getName(), prop);
      //accessMap[prop].rules;
      accessMap[prop] = this.recalcRules(accessMap[prop].rules);
    }

    debug('%s recalced accessMap %o', this.model.getName(), accessMap);

    hl('%s: resulting accessMap: %o', this.model.getName(), accessMap);
    return accessMap;
  }

  /**
   * Recalculates rules
   *
   * @param rules
   */
  recalcRules(rules) {

    let firstVal = rules.shift();

    let newVal = {
      rules: [firstVal]
    };

    if (typeof firstVal === 'boolean') {
      newVal = firstVal;
    }

    for (let rule of rules) {
      newVal = clone(this.getNewApplyValue(clone(newVal), clone(rule)));
    }

    return newVal;
  }


  /**
   * Fetch and apply dependent data to build final access map
   *
   * @returns {Promise.<void>}
   */
  async initDependencies() {
    debug('%s init deps', this.model.getName());

    let depRules = this.getDependentRules();

    // Check if dep rule exist
    if (!depRules) {
      debug('%s no dep rules', this.model.getName());
      return null; //??
    }

    debug('%s dep rules found %o', this.model.getName(), depRules);


    let depQueries = this.getCompiledDependentModelQueries()

  }

  /**
   * Get new apply value
   *
   * @param prevValue
   * @param applyValue
   */
  getNewApplyValue(prevValue, applyValue) {
    // Algorithm that applies value on access map property

    // If strict value just apply as is
    if (typeof(applyValue) === 'boolean') {
      return applyValue;
    }

    // If apply value if rule object

    // Check if previous value is boolean
    if (typeof(prevValue) === 'boolean') {
      // If previous value is boolean
      // Replace it with apply value only if it inverts allow value
      if (prevValue !== applyValue.allow) {
        return {
          rules: [applyValue]
        }
      }

      // Otherwise return prev value
      return prevValue;
    }

    // If prev value is object with rule set, just push additional rule
    prevValue.rules.push(applyValue);

    return prevValue;
  }


  /**
   * Build rule queries
   */
  buildRuleQueries() {
    let ctx = this.ctx;

    debug(this.model.getName(), 'building rule queries');

    for (let key of Object.keys(this.accessMap)) {
      let value = this.accessMap[key];

      if (typeof(value) === 'boolean') {
        continue;
      }

      //let ruleSet = value.rules;

      // calculate unique rule set hash
      //let hash = this.toHash(ruleSet);

      // TODO: memoize
      this.createRuleQueriesForMapValue(value);

      // we should convert rule set to query only once
      // if (queries[hash]) {
      //   accessMap[key] = queries[hash];
      //   continue;
      // }
      //
      // let queryVal = this.ruleSetToQuery(ruleSet, ctx);
      // accessMap[key] = queryVal;
      // queries[hash] = queryVal;
    }

    debug('%s: map with rule queries %O', this.model.getName(), this.accessMap);

    this.built.ruleQueries = true;
  }

  /**
   * Create individual queries for each rule of map value
   *
   * @param sourceValue
   */
  createRuleQueriesForMapValue(sourceValue) {
    let ctx = this.ctx;

    let value = clone(sourceValue);

    // Lets expand each rule in rule set
    // That mean convert role to condition and merge it with scope
    // Build queries set. Convert each individual rule to query
    // we assume that there is only dynamic roles left

    for (let rule of value.rules) {
      let model = this.isDependentRule(rule) ? this.getDependentModel(rule) : this.model;

      let query = {};

      if (rule.scope) {
        // TODO: what arguments?
        query = rule.scope();
      }

      // TODO: need to handle both scopes - checkRelation and current rule scope.
      // TODO: maybe create 2 queries - internal and external and merge them on applyDependentData step
      if (!rule.roles) {

        // TODO: it assumes that we have only correct rules here
        rule.query = query;
        continue;
      }

      let conds = [];
      // Finding only dynamic roles
      for (let roleName of rule.roles) {
        let role = model.getDynamicRoles(ctx)[roleName];

        if (!role) {
          // This actually could happen because our rule might be dynamic only because of scope
          continue;
        }

        // Execute handler
        // TODO: could it be async? On what data it depends? Should we execute it multiple times?
        let calculatedCond = role.cond(ctx);

        if (typeof calculatedCond === 'boolean') {
          // Not obvious but we skip boolean valued here, as it actually acts as static role
          // and should've been handled before. We can't to anything with boolean at this step
          continue;
        }

        let cond = Object.assign(calculatedCond, query);
        conds.push(cond);
      }

      if (!conds.length) {
        // return {
        //   allow: rule.allow,
        //   query: query
        // };

        rule.query = query;
        continue;
      }

      let result = {};

      // check if more than one condition
      if (conds.length > 1) {
        result = { '$or': conds }
      } else {
        result = conds[0];
      }

      rule.query = result;
    }
  }

  /**
   * Build query for every ruleset in accessmap values
   */
  buildRuleSetQueries() {
    debug(this.model.getName(), 'building rule set queries');

    // Handle dependencies
    if (!this.built.ruleQueries) {
      debug('%s: buildRuleSetQueries - need to build rule queries', this.model.getName());
      this.buildRuleQueries();
    }

    // anyway need to iterate all values
    for (let key of Object.keys(this.accessMap)) {
      // Lets merge all queries set to single query
      let value = this.accessMap[key];

      // TODO not sure
      if (typeof(value) === 'boolean') {
        continue;
      }

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

      toQuery(mergedQuery, value.rules.slice(0));
      value.query = mergedQuery;
    }

    debug('%s: Resulting access map with rule set queries. %o', this.model.getName(), this.accessMap);
    this.built.ruleSetQueries = true;
  }

  /**
   * Convert the whole access map to single query if possible
   */
  async getQuery() {
    debug('%s: getQuery', this.model.getName());

    // Handle dependencies
    if (!this.built.ruleQueries) {
      debug('%s: getQuery - need to build rule queries', this.model.getName());
      this.buildRuleQueries();
    }

    if (!this.built.ruleSetQueries) {
      debug('%s: getQuery - need to build ruleset queries', this.model.getName());
      this.buildRuleSetQueries();
    }

    let queries = {};

    for (let ruleSet of Object.values(this.accessMap)) {
      if (typeof(ruleSet) === 'boolean') {
        continue;
      }

      // calculate unique rule set hash
      // FIXME: make another unique check. possible circular issues? concat ids of rules
      let hash = this.toHash(ruleSet);

      // we should convert rule set to query only once
      if (queries[hash]) {
        continue;
      }

      queries[hash] = ruleSet.query;
    }

    queries = Object.values(queries);

    debug('%s: getQuery - queries: %o', this.model.getName(), queries);

    if (!queries.length) {
      return null;
    }

    // TODO: Probably use something like conditionsToOrQuery
    if (queries.length > 1) {
      return { '$or': queries };
    }

    return queries[0];
  }

  /**
   * To hash
   * @param data
   */
  toHash(data) {
    return md5(JSON.stringify(data));
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
   * Check that all elements of access map equals false
   *
   * @returns {boolean}
   */
  isFails() {
    return Object.values(this.accessMap).every(item => {
      if (typeof(item) !== "boolean") {
        return false;
      }

      return !item;
    });
  }

  /**
   * Check that all values are boolean true values
   *
   * @returns {boolean|*}
   */
  isPassing() {
    return Object.values(this.accessMap).every(item => {
      if (typeof(item) !== "boolean") {
        return false;
      }

      return !!item;
    });
  }

  /**
   * If access map
   * If at least one value of access map is true
   *
   * @returns {boolean}
   */
  hasAtLeastOneTrueValue() {
    for (let val of Object.values(this.accessMap)) {
      if (typeof(val) === 'boolean' && val) {
        return true;
      }
    }

    return false;
  }

  /**
   *
   * @returns {boolean}
   */
  hasAtLeastOneFalseValue() {
    for (let val of Object.values(this.accessMap)) {
      if (typeof(val) === 'boolean' && !val) {
        return true;
      }
    }

    return false;
  }


  /**
   * Check if finally access map has dependent models in it
   * So conditions might not be fully calculated
   *
   * @returns {boolean}
   */
  hasDependentRules() {
    for (let val of Object.values(this.accessMap)) {
      if (typeof(val) === 'boolean') {
        continue;
      }

      for (let rule of val.rules) {
        if (this.isDependentRule(rule)) {
          return true;
        }
      }
    }

    return false;
  }


  /**
   * Check if rule match action
   *
   * @param action
   * @returns {Function}
   */
  isRuleMatchAction(action) {
    return function(rule) {
      if (!~rule.actions.indexOf('*') && !~rule.actions.indexOf(action)) {
        return false;
      }

      return true;
    }
  }

  /**
   * Returns compiled query for querying all dependent documents
   * Grouped by model
   *
   * @returns {object}
   */
  getCompiledDependentModelQueries() {

    debug('%s getCompiledDependentModelQueries', this.model.getName());

    // depends on buildRuleQueries
    // Requires individual rule queries to be built first
    if (!this.built.ruleQueries) {
      this.buildRuleQueries();
    }

    let models = {};

    // TODO: Could be simplified a lot
    for (let val of Object.values(this.accessMap)) {
      if (typeof(val) === 'boolean') {
        continue;
      }

      let dependentRules = val.rules.filter(this.isDependentRule);
      if (!dependentRules.length) {
        continue;
      }

      dependentRules.forEach(rule => {

        let model = this.getDependentModel(rule);
        if (!models[model.getName()]) {
          models[model.getName()] = {
            queries: [],
            model: model
          };
        }
        models[model.getName()].queries.push(rule.query);
      })
    }

    // compile queries for each model
    for (let modelQueries of Object.values(models)) {
      modelQueries.query = this.queriesToOrQuery(modelQueries.queries);
    }

    return models;
  }

  /**
   * Convert rule to strict rule. Trims scopes, roles
   *
   * @deprecated
   *
   * @param rule
   */
  ruleToStrict(rule) {
    // TODO should we clone and return new rule
    delete rule.scope;
    rule.roles = ['*']; // Do we actually need it?
  }

  /**
   * Returns only dependent rules
   *
   * TODO: no very optimal approach
   */
  getDependentRules() {
    let result = [];

    let ids = new Set();

    for (let prop of Object.keys(this.accessMap)) {

      let val = this.accessMap[prop];

      if (typeof(val) === 'boolean') {
        continue;
      }

      let dependentRules = val.rules.filter(this.isDependentRule);
      if (!dependentRules.length) {
        continue;
      }

      dependentRules.forEach(rule => {
        if (!ids.has(rule.id)) {
          result.push(rule);
          ids.add(rule.id);
        }
      });
    }

    return result;
  }

  /**
   * Apply dependent data
   * TODO: call dependent methods
   *
   * @param data
   */
  applyDependentData(data) {

    debug('%s: applying dependent data %j', this.model.getName(), data);

    if (!this.built.ruleQueries) {
      this.buildRuleQueries();
    }

    debug('%s: rule queries are built', this.model.getName());

    // Now we need to filter data using sift
    for (let prop of Object.keys(this.accessMap)) {
      // TODO we are replacing same val multiple times
      let val = this.accessMap[prop];

      if (typeof(val) === 'boolean') {
        continue;
      }

      debug('%s: val %o', this.model.getName(), val);

      let dependentRules = val.rules.filter(this.isDependentRule);

      debug('%s: depRules %o', this.model.getName(), dependentRules);
      if (!dependentRules.length) {
        continue;
      }

      dependentRules.forEach(rule => {

        debug('%s: iterating rule %o', this.model.getName(), rule);

        let model = this.getDependentModel(rule);
        let modelName = model.getName();

        // TODO optimize - no need to reapply same query to the same data
        let queryResult = sift(rule.query, data[modelName].data);

        debug('%s: queryResult %o', this.model.getName(), queryResult);

        if (!queryResult.length) {
          // Mark accessMap value as need to be recalculated
          val.recalc = true;

          // Convert rule to strict rule
          //this.ruleToStrict(rule);
          rule.recalc = true;
        } else {

          // Get relation to check in order to extract foreignKey name
          let relation = this.model.schema.properties[rule.checkRelation.name];
          let foreignKey = relation.foreignKey;
          //let property = this.model.schema.properties[foreignKey];

          // should we fix the library
          let newQuery = {[foreignKey]: {'$in': queryResult.map(doc =>
            doc._id
          )}};

          // Store orig query just in case
          rule.origQuery = rule.query;
          rule.query = newQuery;

          debug('%s: newQuery %o', this.model.getName(), newQuery);
        }
      });

      // Recalculate the whole value if needed
      if (!val.recalc) {
        continue;
      }

      let rules = clone(val.rules);
      // Clear current ruleset
      //delete val.rules;

      this.accessMap[prop] = {
        rules: []
      };

      for (let [index, rule] of rules.entries()) {

        let applyValue = !rule.allow; // TODO: will it actually work?

        if (!rule.recalc) {
          applyValue = clone(rule);
        }

        this.accessMap[prop] = this.getNewApplyValue(this.accessMap[prop], applyValue);
      }

      debug('%s: recalculated prop %s %o', this.model.getName(), prop, this.accessMap[prop]);
    }

    debug('%s: access map with applied data %o',this.model.getName(), this.accessMap);
  }

  /**
   * Build single query from array of queries
   *
   * @param queries
   */
  queriesToOrQuery(queries) {
    // check if more than one condition
    if (queries.length > 1) {
      return { '$or': queries }
    }

    return queries[0];
  }

  /**
   * Remove impossible roles
   *
   * @param ctx
   * @param sourceRule
   */
  removeImpossibleRoles(ctx, sourceRule) {
    let rule = clone(sourceRule);

    // If rule * exists - left only it
    // TODO: should be on app initialization step
    if (~rule.roles.indexOf('*')) {
      rule.roles = ['*'];
      return rule;
    }

    // Get dynamic roles for model from current model or related
    let dynamicRoles = this.isDependentRule(rule)
      ? this.getDependentModel(rule).getPossibleDynamicRoleNames(ctx)
      : this.model.getPossibleDynamicRoleNames(ctx);

    let roles = [];

    let matchedStaticRoles = this.getMatchedRoles(rule, this.staticRoles);
    roles = roles.concat(matchedStaticRoles);

    // todo should be on app init step
    let matchedDynamicRoles = this.getMatchedRoles(rule, dynamicRoles);

    roles = roles.concat(matchedDynamicRoles);

    // TODO does it make sense?
    // It is possible to manually specify roles for which we will build access map
    // TODO: don't like it placed here. The function should only remove impossible roles
    // TODO: and not do anything else
    if (this.options.roles && !~this.options.roles.indexOf('*')) {
      roles = this.options.roles;
    }

    // remove all roles that not in matched roles
    rule.roles = rule.roles.filter(role => {
      return ~roles.indexOf(role);
    });

    return rule;
  }

  /**
   * Check if rule is deferred - allow value could not be calculated immediately
   *
   * @param rule
   */
  isDeferredRule(rule) {
    // TODO: the purpose of this is not really clear. Change algorithm

    if (rule.scope) {
      return true;
    }

    // TODO: not sure it wasn't handled before
    if (~rule.roles.indexOf('*')) {
      return false;
    }

    if (this.isRuleMatchRoles(rule, Object.keys(this.dynamicRoles))) {
      return true;
    }

    return false;

    // return (rule.scope || (!~rule.roles.indexOf('*') && !this.isRuleMatchRoles(rule, this.staticRoles)))
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
   * Check if rule depends on another model
   *
   * @param rule
   * @returns {boolean}
   */
  isDependentRule(rule) {
    return !!rule.checkRelation;
  }

  /**
   * Get model that rule depends on
   * @param rule
   * @returns {*}
   */
  getDependentModel(rule) {
    return Spikenail.models[rule.checkRelation.name];
  }
}