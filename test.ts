import {
  Source,
  GraphQLSchema,

  parse,
  buildSchema,
  printSchema,
} from 'graphql';
import * as _ from 'lodash';

import { joinSchemas } from './index';

type TestSchema = string;
type TestSchemasMap = { [name: string]: TestSchema };
function testJoin(testSchemas: TestSchemasMap, joinSDL: string[]) {
  const remoteSchemas = _.mapValues(testSchemas, (sdl, name) => ({
    schema: buildSchema(new Source(sdl, name)),
    proxy: () => { throw Error('stub') },
  });
  const joinAST = parse(new Source(joinSDL, 'Join SDL'));
  const schema = joinSchemas(joinAST, remoteSchemas);

  expect(schema).toBeInstanceOf(GraphQLSchema);
  expect(printSchema(schema)).toMatchSnapshot();
  return schema;
}

describe('custom Query type', () => {
  test('one schema', () => {
    const schema = testJoin({
      test: 'type Query { foo: String, bar:String }',
    }, `
      type Query {
        foo: String @resolveWith(query: "foo")
      }
      query foo @send(to: "test") { foo }
    `);
  });
  test('two schemas', () => {
    const schema = testJoin({
      test1: 'type Query { foo: String, bar: String }',
      test2: 'type Query { baz: String }',
    }, `
      type Query {
        foo: String @resolveWith(query: "foo")
        baz: String @resolveWith(query: "baz")
      }
      query foo @send(to: "test1") { foo }
      query baz @send(to: "test2") { baz }
    `);
  });
});
