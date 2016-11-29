import {
  GraphQLObjectType,
  GraphQLList,
  GraphQLString,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLID,
  GraphQLSchema,
  GraphQLNonNull
} from 'graphql';

export default new GraphQLObjectType({
  name: 'MutationError',
  fields: () => ({
    message: {
      type: GraphQLString
    },
    code: {
      type: GraphQLString
    },
    field: {
      type: GraphQLString
    }
  })
})