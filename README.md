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

## Model

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
