export type SchemaProxy = (query: DocumentNode) => Promise<ExecutionResult>;
export type RemoteSchema = {
  schema: GraphQLSchema,
  proxy: SchemaProxy,
  prefix?: string
};
export type RemoteSchemasMap = { [name: string]: RemoteSchema };
