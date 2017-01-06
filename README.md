<big><h1 align="center">spikenail</h1></big>

<big><h1 align="center">WORK IN PROGRESS</h1></big>

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
</p>

Spikenail is an open-source Node.js ES7 framework that allows you to build GraphQL API with little or no coding.

## Features

Full support of ES7 features

Native GraphQL support

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
    actions: ['*']
  }, {
    allow: true,
    properties: ['token'],
    actions: [ACTION_CREATE]
  }]
});
```

### CRUD

In spikenail every CRUD action is a set of middlewares.
These middlewares are not the request middlewares and exists separately.

Default middlewares are:

* Access control middleware
* Validation middleware
* Before action
* Process action
* After action

The whole chain could be changed in any way.

Example of how "Before action" middleware could be overriden:

In the model class:

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

## GraphQL API

### Queries

#### node

```js
node(id: ID!): Node
```

https://facebook.github.io/relay/docs/graphql-object-identification.html#content

#### viewer

Root field

```
viewer: viewer

type viewer implements Node {
  id: ID!
  user: User,
  allXs(): viewer_XConnection
}
```


#### Query all items of a specific model

For `Article` model:

```
query {
    viewer {
        allArticles() {
            id, title, text
        }
    }
}
```


#### Query single item

Query a specific article by unique field:

```
query {
    getArticle(id: "article-id-1") {
        id, title, text
    }
}
```

#### Relation queries

#### Filtering queries

### Mutations

### Creating a model

### Adding custom method

## ACL

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
