import { InMemorySaaSStore } from "@sapienx/saas-core"

export function createDeterministicFixture() {
  const store = new InMemorySaaSStore()
  const owner = store.addUser({ id: "user-owner", email: "owner@example.test" })
  const member = store.addUser({ id: "user-member", email: "member@example.test" })
  const { workspace } = store.createWorkspace({ ownerUserId: owner.id, name: "Core Fixture", slug: "core-fixture" })
  return { store, owner, member, workspace }
}
