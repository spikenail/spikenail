import {
  GraphQLObjectType,
  GraphQLString,
  GraphQLBoolean,
  GraphQLNonNull
} from 'graphql';

export default new GraphQLNonNull(new GraphQLObjectType({
  name: 'PageInfo',
  fields: () => ({
    hasNextPage: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    hasPreviousPage: {
      type: new GraphQLNonNull(GraphQLBoolean)
    },
    startCursor: {
      type: GraphQLString
    },
    endCursor: {
      type: GraphQLString
    }
  })
}));
