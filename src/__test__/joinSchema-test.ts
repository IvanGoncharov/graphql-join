import { testJoin } from './testUtils';

describe('joinSchema', () => {

  test('Proxy only types referenced inside join schema', async () => {
    const execute = testJoin(
      {
        test: `
          type TypeToIgnore { stub: String, stubSubtype: SubTypeToIgnore }
          type SubTypeToIgnore { baz: String }
          type TypeToProxy { foo: String, bar: SubTypeToProxy }
          type SubTypeToProxy { baz: String }
          type Query {
            typeToIgnore: TypeToIgnore
            typeToProxy: TypeToProxy
          }
        `,
      }, `
        type Query {
          typeToProxy: TypeToProxy @resolveWith(query: "typeToProxy")
        }
        query typeToProxy @send(to: "test") {
          typeToProxy {
            ...CLIENT_SELECTION
          }
        }
      `);

    await execute(`
      {
        typeToProxy {
          foo
          bar {
            baz
          }
        }
      }
    `);
  });

  test('Prefix remote types', async () => {
    const execute = testJoin(
      {
        test: {
          idl: `
            type Query { foo: BarOrBaz }
            union BarOrBaz = Bar | Baz
            type Bar { bar: String }
            type Baz { baz: String }
          `,
          prefix: 'PrEfIx_'
        },
      },
      'schema { query: PrEfIx_Query }'
    );

    await execute(
      `{
        foo {
          ... on PrEfIx_Bar { bar }
          ... on PrEfIx_Baz { baz }
        }
      }`,
      { test: { data: {
        foo: { ___t_test: 'Baz', baz: 'test::Baz::baz' }
      }}}
    );
  });

});
