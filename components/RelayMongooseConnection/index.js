const PREFIX = 'mongodbconnection:';

export const base64 = (str) => (new Buffer(str, 'ascii')).toString('base64');
export const unbase64 = (b64) => (new Buffer(b64, 'base64')).toString('ascii');

/**
 * Rederives the offset from the cursor string
 */
export function cursorToOffset(cursor) {
  return parseInt(unbase64(cursor).substring(PREFIX.length), 10);
}

/**
 * Given an optional cursor and a default offset, returns the offset to use;
 * if the cursor contains a valid offset, that will be used, otherwise it will
 * be the default.
 */
export function getOffsetWithDefault(cursor, defaultOffset) {
  if (cursor === undefined) {
    return defaultOffset;
  }
  const offset = cursorToOffset(cursor);
  return isNaN(offset) ? defaultOffset : offset;
}

/**
 * Creates the cursor string from an offset.
 */
export function offsetToCursor(offset) {
  return base64(PREFIX + offset);
}

/**
 * Accepts a mongoose query and connection arguments, and returns a connection
 * object for use in GraphQL. It uses array offsets as pagination, so pagiantion
 * will work only if the data set is satic.
 */
export default async function connectionFromMongooseQuery(mongooseQuery, args = {}, mapper) {
  const { after, before, first, last } = args;
  const count = await mongooseQuery.count();
  const beforeOffset = getOffsetWithDefault(before, count);
  const afterOffset = getOffsetWithDefault(after, -1);

  let startOffset = Math.max(-1, afterOffset) + 1;
  let endOffset = Math.min(count, beforeOffset);

  if (first !== undefined) {
    endOffset = Math.min(endOffset, startOffset + first);
  }
  if (last !== undefined) {
    startOffset = Math.max(startOffset, endOffset - last);
  }

  const skip = Math.max(startOffset, 0);
  const limit = endOffset - startOffset;

  // If supplied slice is too large, trim it down before mapping over it.
  mongooseQuery.skip(skip);
  mongooseQuery.limit(limit);

  // Short circuit if limit is 0; in that case, mongodb doesn't limit at all
  let slice = [];
  if (limit > 0) {
    const docs = await mongooseQuery.find();
    // TODO: any reason for doing this? We need mongoose models instances
    //slice = docs.map(doc => doc.toObject());
    slice = docs;
  }

  // If we have a mapper function, map it!
  if (typeof mapper === 'function') {
    slice = slice.map(mapper);
  }

  const edges = slice.map((value, index) => ({
    cursor: offsetToCursor(startOffset + index),
    node: value,
  }));

  const firstEdge = edges[0];
  const lastEdge = edges[edges.length - 1];
  const lowerBound = after ? (afterOffset + 1) : 0;
  const upperBound = before ? Math.min(beforeOffset, count) : count;

  return {
    edges,
    pageInfo: {
      startCursor: firstEdge ? firstEdge.cursor : null,
      endCursor: lastEdge ? lastEdge.cursor : null,
      hasPreviousPage: last !== null ? startOffset > lowerBound : false,
      hasNextPage: first !== null ? endOffset < upperBound : false,
    },
  };
}