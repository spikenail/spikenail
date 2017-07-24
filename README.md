# <img src="logo/logo-title.png" height="100" />

Spikenail is an open-source Node.js ES7 framework that allows you to build GraphQL API with little or no coding.

<p align="center">
  <a href="https://npmjs.org/package/spikenail">
    <img src="https://img.shields.io/npm/v/spikenail.svg?style=flat-square"
         alt="NPM Version">
  </a>

  <a href="https://coveralls.io/r/spikenail/spikenail">
    <img src="https://img.shields.io/coveralls/spikenail/spikenail.svg?style=flat-square"
         alt="Coverage Status">
  </a>

  <a href="https://travis-ci.org/spikenail/spikenail">
    <img src="https://img.shields.io/travis/spikenail/spikenail.svg?style=flat-square"
         alt="Build Status">
  </a>

  <a href="https://npmjs.org/package/spikenail">
    <img src="http://img.shields.io/npm/dm/spikenail.svg?style=flat-square"
         alt="Downloads">
  </a>

  <a href="https://david-dm.org/spikenail/spikenail.svg">
    <img src="https://david-dm.org/spikenail/spikenail.svg?style=flat-square"
         alt="Dependency Status">
  </a>

  <a href="https://github.com/spikenail/spikenail/blob/master/LICENSE">
    <img src="https://img.shields.io/npm/l/spikenail.svg?style=flat-square"
         alt="License">
  </a>

  <a href="https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=XQKACYYHMX23U">
      <img src="https://img.shields.io/badge/Donate-PayPal-green.svg?style=flat-square"
           alt="Donate">
  </a>

</p>

## Features

Full support of ES7 features

Native GraphQL support

Relay compatible API

Easy to define access control of any complexity:
nested relations, scopes, custom dynamic roles

Advanced schema definition: virtual fields, custom resolvers

Validations

Flexibility: easy to adjust or override every part of a framework

## Install

```
npm install -g generator-spikenail
yo spikenail
```

## Core concepts

Ability to build an API just by configuring it is the main idea of spikenail.
That configuration might include relations, access control, validations and everything else we need.

At the same time we should provide enough flexibility by allowing to adjust or override every action spikenail does.
From this point of view, spikenail provides an architecture and default implementation of it.

The configuration mentioned above stored in models.

Example model `models/Item.js`:

```js
import { MongoDBModel } from 'spikenail';

class Item extends MongoDBModel {

  /**
   * Example of custom method
   */
  customMethod() {
    // Access underlying mongoose model
    return this.model.find({ 'category': 'test' }).limit(10);
  }
}

export default new Item({
  name: 'item',
  properties: {
    id: {
      type: 'id'
    },
    name: {
      type: String
    },
    description: {
      type: String
    },
    position: {
      type: Number
    },
    token: {
      type: String
    },
    virtualField: {
      virtual: true,
      // Ensure that dependent fields will be queried from the database
      dependsOn: ['position'],
      type: String
    },
    userId: {
      type: 'id'
    },
    // Relations
    subItems: {
      relation: 'hasMany',
      ref: 'subItem',
      foreignKey: 'itemId'
    },
    user: {
      relation: 'belongsTo',
      ref: 'user',
      foreignKey: 'userId'
    }
  },
  // Custom resolvers
  resolvers: {
    description: async function(_, args) {
      // It is possible to do some async actions here
      let asyncActionResult = await someAsyncAction();
      return asyncActionResult ? _.description : null;
    },
    virtualField: (_, args) => {
      return 'justCustomModification' + _.position
    }
  },
  validations: [{
    field: 'name',
    assert: 'required'
  }, {
    field: 'name',
    assert: 'maxLength',
    max: 100
  }, {
    field: 'description',
    assert: 'required'
  }],
  acls: [{
    allow: false,
    properties: ['token'],
    actions: '*'
  }, {
    allow: true,
    properties: ['token'],
    actions: ['create']
  }]
});
```

### CRUD

In spikenail every CRUD action is a set of middlewares.
These middlewares are not the request middlewares and exists separately.

Some of default middlewares are:

* Access control middleware
* Validation middleware
* Before action
* Process action
* After action

The whole chain could be changed in any way.

For example, you can override "Before action" middleware in following way:

`models/Item.js`

```js

  async beforeCreate(result, next, opts, input, ctx) {
    let checkResult = await someAsyncCall();

    if (checkResult) {
        return next();
    }

    result.errors = [{
        message: 'Custom error',
        code: '40321'
    }];
  }

```

## Configuration

Configuration files are stored under `config` folder

### Data sources

Currently, only MongoDB supported.

It is recommended to store all configuration using environment variables

Example of `config/sources.js`

```js
export default {
  'default': {
    adapter: 'mongo',
    connectionString: process.env.SPIKENAIL_MONGO_CONNECTION_STRING
  }
}
```

## GraphQL API

### Queries

#### node

```js
node(id: ID!): Node
```

https://facebook.github.io/relay/docs/graphql-object-identification.html#content

Example:

```js
{
    node(id: "some-id") {
        id,
        ... on Article {
            title,
            text
        }
    }
}
```

#### viewer

Root field

```js
viewer: viewer

type viewer implements Node {
  id: ID!
  user: User,
  allXs(): viewer_XConnection
}
```


#### Query all items of a specific model (allXs)

For `Article` model:

```js
query {
    viewer {
        allArticles() {
            edges {
            node {
                id,
                title,
                text
                }
            }
        }
    }
}
```


#### Query single item (getX)

Query a specific item by unique field:

```js
query {
    getArticle(id: "article-id-1") {
        id, title, text
    }
}
```

#### Pagination

Example:

```js
{
    getArticle(id: "some-id") {
        id
        userId
        user {
            id
            name
        }
        tags(first: 10, after: "opaqueCursor") {
            edges {
                node {
                    id
                    name
                    itemsCount
                }
            }
            pageInfo {
                hasNextPage
                hasPreviousPage
                endCursor
                startCursor
            }
        }
    }
}

```

See relay documentation for more details: https://facebook.github.io/relay/graphql/connections.htm


#### Filtering and sorting

Example:

```js
query {
  viewer {
    allBoards(filter: { where: { name: { regexp: "^Public" } }, order: "id DESC" }) {
      edges {
        node {
          id
          userId
          name
        }
      }
    }
  }
}
```

#### Mutations

##### createX

```js
mutation createX(input: CreatexInput): CreatexPayload
```

Example:

```js
mutation {
  createItem(input: { name: "New item", clientMutationId: "123" }) {
    item {
      id
      name
    }
    clientMutationId
    errors {
      message
      code
    }
  }
}
```

##### updateX

```js
mutation updateX(input: UpdatexInput): UpdatexPayload
```

Example:

```js
mutation {
  updateItem(input: { name: "New item name", clientMutationId: "123" }) {
    item {
      id
      name
    }
    clientMutationId
    errors {
      message
      code
    }
  }
}
```


##### removeX

```js
mutation removeX(input: RemovexInput): RemovexPayload
```

Example:

```js
mutation {
  removeItem(input: { id: "Ym9hcmQ6NTkyYmZjOTA2ZjM5Zjc5MGNmNGI5Yjhh" }) {
    removedId
    errors {
      code
      message
    }
  }
}
```

## Defining a Model

### Using model generator

You can use model generator in order to simplify model creation:

```
yo spikenail:model board
```

This will create models/Board.js file with only id field:

```js
import { MongoDBModel } from 'spikenail';

class Board extends MongoDBModel {}

export default new Board({
  name: 'Board',
  properties: {
    id: {
      type: 'id'
    }
  }
});
```

### Relations

#### hasMany relation

`models/Book.js`

```js
properties: {
    authors: {
      relation: 'hasMany',
      ref: 'author',
      foreignKey: 'bookId'
    }
}
```

`authors` definition could be simplified:

```js
authors: {
  relation: 'hasMany'
}

```

In this case framework will try to guess other parameters.

##### Custom hasMany condition

```js
 getConditions: function(_) {
    return { otherModelField: _.name }
 }
```

#### belongsTo relation

```js
list: {
    relation: 'belongsTo'
    ref: 'list',
    foreignKey: 'listId'
}
```

Simplified definition:

```js
list: {
    relation: 'belongsTo'
}
```


#### MongoDBModel

Underlying model is a [mongoose](http://mongoosejs.com/) model. You can access it through `this.model`

##### Changing collection name

```js
providerOptions: {
    collection: 'customName'
}
```

## Authentication

### Simple token authentication middleware

Spikenail has built-in middleware for authentication.

It looks for `tokens` array stored in `User` model in following format:

```js
[{
    token: "user-random-token"
}, {
    token: "user-random-token-2"
}]
```

Current user will be placed in context and accessible through `ctx.currentUser`

## ACL

### Introduction

ACL rules are specified under `acls` property of model schema. Rules are processed by framework one by one in natural order.
By default there is no any access restrictions.

Take a look at below example:

```js
acls: [{
    allow: false,
    roles: ['*'],
    actions: ['*']
}, {
    allow: true,
    roles: ['*'],
    actions: ['*'],
    scope: function() {
        return { isPublic: true }
    }
}
```

First rule here is disable everything for everyone:

```js
{
    allow: false,
    roles: ['*'],
    actions: ['*']
}
```

Second rule allows everything if `isPublic` property of a item equals `true`.

Rules notation could be simplified and above rules might be written as:

```js
acls: [{
    allow: false
}, {
    allow: true
    scope: function() {
        return { isPublic: true }
    }
}

```

### Rule structure

#### allow

Each rule must have `allow` property defined. `allow` is boolean value
that indicates if rule allows something or disallows.

Example:

```js
allow: true
```

#### properties (optional)
`properties` is an array of properties of model that rule should apply to.
Omit or use * sign to apply to all rules.

#### actions (optional)

Specify what actions rule should be applied to.
There are 4 types of actions:

* create
* update
* remove
* read

Omit this property or use * sign to apply to all actions.

Example:

```js
actions: ['create', 'update']
```

#### scope

Scope is a mongodb condition. Rule will be applied only to those documents that match the scope.

Example

```js
{ isPublic: true }
```

The rule will be applied only to documents that have `isPublic` property equals `true`.

Scope could be defined as a function, in this case you have an access to the context variable:

```js
scope: function(ctx) {
    return { isPublic: true }
}
```

#### roles

`roles` is an array of roles that rule should apply to.

Example

```js
roles: ['anonymous', 'member']
```

Roles might be static or dynamic.

#### Static roles

Static roles are roles that not depends on particular document or data set.
They calculated once per request for current user.

Built-in static roles are:

* anonymous
* user

##### Adding your own static roles

Override `getStaticRoles` function of the model.

#### Dynamic roles

Dynamic roles are calculated for each particular document.
For example, role `owner` means that `currentUser.id === fetchedDocument.id`

Built-in dynamic roles are:

* owner

###### Defining dynamic roles

Dynamic roles are defined using `roles` object of model schema.

For example, we have `members` array where sharing information stored in following format:


```js
[{
    userId: 123
    role: 'member'
}, {
    userId: 456,
    role: 'observer'
}]
```

Then we can define role `member` in the model schema:

```js
roles: {
 member: {
   cond: function(ctx) {
     return { 'members': { '$elemMatch': { 'userId': ctx.currentUser.id, role: 'member' } } }
   }
 }
}
```

And use it in the roles property of ACL rule:

```js
roles: ['member']
```


#### Access based on another model

In some cases we want to apply rule only if another model satisfies some condition.
We can use checkRelation property for that.

##### checkRelation

Example:

`Article.js` model has defined belongsTo relation

```js
blog: {
    relation: 'belongsTo'
}
```

We want allow for `user` to read an article only if he can read the blog it belongs to:

```js
acls: [{
    allow: false
}, {
    allow: true,
    roles: ['user'],
    actions: ['read'],
    checkRelation: {
        name: 'blog',
        action: 'read'
    }
}]
```

If checkRelation condition is not satisfied, rule will not be applied at all.
It means that `allow: true` will not become `allow: false` and vice versa. Rule will be filtered out.

## Validations

Usually, the data that we receive from users needs to be validated. It is easy to do with spikenail.
For example, we want `name` to be required property and its length to not exceed 50 characters. 
This could be done in following way:

`models/Item.js`

```js
validations: [{
  field: 'name',
  assert: 'required'
}, {
  field: 'name',
  assert: 'maxLength',
  max: 50
}]
```

## TODO

GraphQL subscriptions

Simple endpoint (non-relay)

## Support

[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=XQKACYYHMX23U)

## License

MIT © [Igor Lesnenko](http://github.com/spikenail)

[npm-url]: https://npmjs.org/package/spikenail
[npm-image]: https://img.shields.io/npm/v/spikenail.svg?style=flat-square

[travis-url]: https://travis-ci.org/spikenail/spikenail
[travis-image]: https://img.shields.io/travis/spikenail/spikenail.svg?style=flat-square

[coveralls-url]: https://coveralls.io/r/spikenail/spikenail
[coveralls-image]: https://img.shields.io/coveralls/spikenail/spikenail.svg?style=flat-square

[depstat-url]: https://david-dm.org/spikenail/spikenail
[depstat-image]: https://david-dm.org/spikenail/spikenail.svg?style=flat-square

[download-badge]: http://img.shields.io/npm/dm/spikenail.svg?style=flat-square
