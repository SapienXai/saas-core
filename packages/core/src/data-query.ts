/** Bounded server-side data contract shared by the PostgreSQL and legacy transports. */
export type DataError = { code: string; message: string; details?: string | null; hint?: string | null }
export type DataResult<T> =
  | { data: T; error: null; count: number | null }
  | { data: null; error: DataError; count: number | null }
type Value = unknown
export type Predicate =
  | { column: string; operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "like" | "ilike"; value: Value }
  | { column: string; operator: "is" | "isNot"; value: null | boolean }
  | { column: string; operator: "in"; value: readonly Value[] }
  | { all: readonly Predicate[] }
  | { any: readonly Predicate[] }

export type Relation = {
  table: string
  alias: string
  columns: string
  foreignKey: string
  inner?: boolean
  reverse?: boolean
  equals?: Readonly<Record<string, unknown>>
}
type Order = { column: string; ascending?: boolean; nullsFirst?: boolean }
type UpsertOptions = { onConflict?: string; ignoreDuplicates?: boolean }
type Values = Record<string, unknown>
type Mutation =
  | { kind: "insert"; values: Values | readonly Values[] }
  | { kind: "update"; values: Values }
  | { kind: "delete" }
  | { kind: "upsert"; values: Values | readonly Values[]; options?: UpsertOptions }

export type TableRequest = {
  table: string
  projection?: string
  relations: readonly Relation[]
  predicates: readonly Predicate[]
  orders: readonly Order[]
  offset?: number
  limit?: number
  count?: "exact"
  head?: boolean
  cardinality?: "single" | "maybeSingle"
  mutation?: Mutation
}
export type RpcRequest = { routine: string; args: object }
export interface DataTransport {
  table<T>(request: TableRequest): Promise<DataResult<T>>
  rpc<T>(request: RpcRequest): Promise<DataResult<T>>
}

type Trim<S extends string> = S extends ` ${infer R}` | `${infer R} ` ? Trim<R> : S
type Keys<S extends string> = S extends `${infer L},${infer R}` ? Trim<L> | Keys<R> : Trim<S>
type Selected<Row, C extends string> = string extends C ? Row : C extends "*" ? Row : {
  [K in Keys<C> as K extends `${infer Alias}:${string}` ? Alias : K]:
    K extends `${string}:${infer Col}` ? Col extends keyof Row ? Row[Col] : unknown :
      K extends keyof Row ? Row[K] : unknown
}
type Item<T> = T extends readonly (infer Entry)[] ? Entry : T
type Schema = { Tables: object; Functions: object }
type OpenSchema = { Tables: Record<string, { Row: Record<string, unknown> }>; Functions: Record<string, { Returns: unknown }> }
type RowFor<S extends Schema, Table extends string> =
  Table extends keyof S["Tables"]
    ? S["Tables"][Table] extends { Row: infer Row } ? Row : never
    : Record<string, unknown>
type RpcFor<S extends Schema, Name extends string> =
  Name extends keyof S["Functions"]
    ? S["Functions"][Name] extends { Returns: infer Return } ? Return : never
    : unknown

/** The fluent methods describe one operation. Executing it consumes no mutable session state. */
export class DataQuery<Row, Result = Row[], S extends Schema = OpenSchema> implements PromiseLike<DataResult<Result>> {
  constructor(private readonly transport: DataTransport, private readonly request: TableRequest) {}

  private next<Next = Result>(change: Partial<TableRequest>) {
    return new DataQuery<Row, Next, S>(this.transport, { ...this.request, ...change })
  }

  select<C extends string = "*">(columns?: C, options?: { count?: "exact"; head?: false }): DataQuery<Row, Selected<Row, C>[], S>
  select<C extends string = "*">(columns: C, options: { count?: "exact"; head: true }): DataQuery<Row, null, S>
  select<C extends string = "*">(columns: C = "*" as C, options?: { count?: "exact"; head?: boolean }) {
    return this.next<Selected<Row, C>[] | null>({ projection: columns, ...options })
  }

  include<T extends string, A extends string, C extends string>(relation: Relation & { table: T; alias: A; columns: C }) {
    type Related = Selected<RowFor<S, T>, C>
    type Output = Item<Result> & Record<A, Related | null>
    return this.next<Output[]>({ relations: [...this.request.relations, relation] })
  }

  where(predicate: Predicate) {
    return this.next({ predicates: [...this.request.predicates, predicate] })
  }

  eq(column: string, value: Value) { return this.where({ column, operator: "eq", value }) }
  neq(column: string, value: Value) { return this.where({ column, operator: "neq", value }) }
  lt(column: string, value: Value) { return this.where({ column, operator: "lt", value }) }
  lte(column: string, value: Value) { return this.where({ column, operator: "lte", value }) }
  gt(column: string, value: Value) { return this.where({ column, operator: "gt", value }) }
  gte(column: string, value: Value) { return this.where({ column, operator: "gte", value }) }
  like(column: string, value: Value) { return this.where({ column, operator: "like", value }) }
  ilike(column: string, value: Value) { return this.where({ column, operator: "ilike", value }) }
  in(column: string, value: readonly Value[]) { return this.where({ column, operator: "in", value }) }
  is(column: string, value: null | boolean) { return this.where({ column, operator: "is", value }) }
  not(column: string, operator: "is", value: null | boolean) {
    if (operator !== "is") throw new Error("Unsupported database negation.")
    return this.where({ column, operator: "isNot", value })
  }

  order(column: string, options?: Omit<Order, "column">) {
    return this.next({ orders: [...this.request.orders, { column, ...options }] })
  }
  limit(limit: number) { return this.next({ limit }) }
  range(first: number, last: number) { return this.next({ offset: first, limit: last - first + 1 }) }
  single() { return this.next<Item<Result>>({ cardinality: "single" }) }
  maybeSingle() { return this.next<Item<Result> | null>({ cardinality: "maybeSingle" }) }
  insert(values: Values | readonly Values[]) { return this.next<null>({ mutation: { kind: "insert", values } }) }
  update(values: Values) { return this.next<null>({ mutation: { kind: "update", values } }) }
  delete() { return this.next<null>({ mutation: { kind: "delete" } }) }
  upsert(values: Values | readonly Values[], options?: UpsertOptions) {
    return this.next<null>({ mutation: { kind: "upsert", values, options } })
  }
  then<T = DataResult<Result>, E = never>(
    onFulfilled?: ((result: DataResult<Result>) => T | PromiseLike<T>) | null,
    onRejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return this.transport.table<Result>(this.request).then(onFulfilled, onRejected)
  }
}

export class CoreDataClient<S extends Schema = OpenSchema> {
  constructor(private readonly transport: DataTransport) {}

  from<T extends string>(table: T) {
    return new DataQuery<RowFor<S, T>, RowFor<S, T>[], S>(this.transport, {
      table, relations: [], predicates: [], orders: [],
    })
  }

  rpc<Name extends string>(routine: Name, args: object = {}) {
    return this.transport.rpc<RpcFor<S, Name>>({ routine, args })
  }

  /** Consumers can supply the return type of a product RPC that is absent from generated types. */
  rpcAs<T>(routine: string, args: object = {}) {
    return this.transport.rpc<T>({ routine, args })
  }
}

export function identifier(name: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error("Invalid database identifier.")
  return '"' + name + '"'
}

export function projectionColumns(projection: string) {
  return projection.split(",").map((part) => {
    const [first, second, ...rest] = part.trim().split(":")
    if (rest.length) throw new Error("Invalid database projection.")
    if (first === "*" && second === undefined) return { column: "*" }
    identifier(first)
    if (second === undefined) return { column: first }
    identifier(second)
    return { column: second, alias: first }
  })
}
