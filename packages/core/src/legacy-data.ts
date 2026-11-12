import { identifier, projectionColumns, type DataResult, type DataTransport, type Predicate, type RpcRequest, type TableRequest } from "./data-query.js"

interface RestClient {
  from(table: string): unknown
  rpc(routine: string, args: object): PromiseLike<DataResult<unknown>>
}
interface RestSource {
  select(columns: string | undefined, options: { count?: "exact"; head?: boolean }): RestQuery
  insert(rows: object[]): RestQuery
  upsert(rows: object[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): RestQuery
  update(values: object): RestQuery
  delete(): RestQuery
}
interface RestQuery extends PromiseLike<DataResult<unknown>> {
  select(columns: string): RestQuery
  or(filters: string): RestQuery
  in(column: string, values: readonly unknown[]): RestQuery
  is(column: string, value: null | boolean): RestQuery
  not(column: string, operator: string, value: unknown): RestQuery
  filter(column: string, operator: string, value: unknown): RestQuery
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean }): RestQuery
  range(from: number, to: number): RestQuery
  limit(count: number): RestQuery
  single(): PromiseLike<DataResult<unknown>>
  maybeSingle(): PromiseLike<DataResult<unknown>>
}
const ops = { eq: "eq", neq: "neq", gt: "gt", gte: "gte", lt: "lt", lte: "lte", like: "like", ilike: "ilike", is: "is", isNot: "not.is", in: "in" } as const

function atom(value: unknown) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return String(value)
  if (typeof value !== "string") throw new Error("Invalid REST filter value.")
  return '"' + value.replace(/["\\]/g, "\\$&") + '"'
}

function logic(predicate: Predicate): string {
  if ("any" in predicate) return "or(" + predicate.any.map(logic).join(",") + ")"
  if ("all" in predicate) return "and(" + predicate.all.map(logic).join(",") + ")"
  identifier(predicate.column)
  const value = predicate.operator === "in" ? "(" + predicate.value.map(atom).join(",") + ")" : atom(predicate.value)
  return predicate.column + "." + ops[predicate.operator] + "." + value
}

export function restTransport(client: RestClient): DataTransport {
  return {
    async table<T>(request: TableRequest): Promise<DataResult<T>> {
      const source = client.from(request.table) as RestSource
      const mutation = request.mutation
      const projection = request.relations.length
        ? [request.projection ?? "*", ...request.relations.map((rel) => {
          identifier(rel.alias)
          identifier(rel.table)
          identifier(rel.foreignKey)
          projectionColumns(rel.columns)
          return rel.alias + ":" + rel.table + "!" + rel.foreignKey + (rel.inner ? "!inner" : "") + "(" + rel.columns + ")"
        })].join(",")
        : request.projection
      let query: RestQuery = !mutation ? source.select(projection, { count: request.count, head: request.head })
        : mutation.kind === "insert" ? source.insert([...Array.isArray(mutation.values) ? mutation.values : [mutation.values]])
        : mutation.kind === "upsert" ? source.upsert([...Array.isArray(mutation.values) ? mutation.values : [mutation.values]], mutation.options)
        : mutation.kind === "update" ? source.update(mutation.values)
        : source.delete()
      if (mutation && projection) query = query.select(projection)
      for (const filter of request.predicates) {
        if ("any" in filter) query = query.or(filter.any.map(logic).join(","))
        else if ("all" in filter) query = query.or(logic(filter))
        else if (filter.operator === "in") query = query.in(filter.column, filter.value)
        else if (filter.operator === "is") query = query.is(filter.column, filter.value)
        else if (filter.operator === "isNot") query = query.not(filter.column, "is", filter.value)
        else query = query.filter(filter.column, ops[filter.operator], filter.value)
      }
      for (const relation of request.relations) {
        for (const [column, value] of Object.entries(relation.equals ?? {})) {
          identifier(column)
          query = query.filter(relation.alias + "." + column, "eq", value)
        }
      }
      for (const { column, ...order } of request.orders) query = query.order(column, order)
      if (request.offset !== undefined && request.limit !== undefined) query = query.range(request.offset, request.offset + request.limit - 1)
      else if (request.limit !== undefined) query = query.limit(request.limit)
      const result = request.cardinality === "single" ? await query.single() : request.cardinality === "maybeSingle" ? await query.maybeSingle() : await query
      return result.error ? { data: null, error: result.error, count: result.count }
        : { data: result.data as T, error: null, count: result.count }
    },
    async rpc<T>(request: RpcRequest): Promise<DataResult<T>> {
      const result = await client.rpc(request.routine, request.args)
      return result.error ? { data: null, error: result.error, count: result.count }
        : { data: result.data as T, error: null, count: result.count }
    },
  }
}
