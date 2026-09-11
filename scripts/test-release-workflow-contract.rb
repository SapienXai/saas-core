require "json"
require "yaml"

WORKFLOW = File.expand_path("../.github/workflows/release-saas-core.yml", __dir__)

def fail_contract(message)
  warn "Workflow contract failure: #{message}"
  exit 1
end

def expect_contract(condition, message)
  fail_contract(message) unless condition
end

workflow = YAML.load_file(WORKFLOW)
jobs = workflow.fetch("jobs")
validate = jobs.fetch("validate-release")
publish = jobs.fetch("publish-npm")
verify = jobs.fetch("verify-published")
github_release = jobs.fetch("github-release")

validate_steps = validate.fetch("steps")
publish_steps = publish.fetch("steps")
verify_steps = verify.fetch("steps")
github_steps = github_release.fetch("steps")

validate_upload = validate_steps.find { |step| step["uses"] == "actions/upload-artifact@v4" }
expect_contract(validate_upload, "validate-release must upload an artifact")
expect_contract(validate_upload.dig("with", "path") == "artifacts/*.tgz", "validate-release must upload artifacts/*.tgz")
expect_contract(validate_upload.dig("with", "name").to_s.include?("steps.release_version.outputs.version"), "validate-release artifact name must be version-specific")

download_steps = publish_steps.select { |step| step["uses"] == "actions/download-artifact@v4" }
expect_contract(download_steps.length == 1, "publish-npm must have exactly one artifact download")
publish_download = download_steps.first
expected_downstream_artifact = "saas-core-release-${{ needs.validate-release.outputs.version }}"
expect_contract(publish_download.dig("with", "name") == expected_downstream_artifact, "publish-npm must download the version-specific release artifact")
expect_contract(publish_download.dig("with", "path") == "artifacts", "publish-npm must download into artifacts")
publish_index = publish_steps.index { |step| step["run"].to_s.include?("pnpm run release:publish") }
publish_download_index = publish_steps.index { |step| step["uses"] == "actions/download-artifact@v4" }
expect_contract(publish_index, "publish-npm must invoke release:publish")
expect_contract(publish_download_index < publish_index, "publish-npm must download artifacts before publishing")

verify_download_steps = verify_steps.select { |step| step["uses"] == "actions/download-artifact@v4" }
expect_contract(verify_download_steps.length == 1, "verify-published must have exactly one artifact download")
verify_download = verify_download_steps.first
expect_contract(verify_download.dig("with", "name") == expected_downstream_artifact, "verify-published must download the same version-specific artifact")
expect_contract(verify_download.dig("with", "path") == "artifacts", "verify-published must download into artifacts")
expect_contract(verify_steps.none? { |step| step["run"].to_s.include?("core:pack") }, "verify-published must not regenerate tarballs")
registry_verify_index = verify_steps.index { |step| step["run"].to_s.include?("pnpm run release:registry-verify") }
registry_install_index = verify_steps.index { |step| step["run"].to_s.include?("pnpm run release:registry-install") }
verify_download_index = verify_steps.index { |step| step["uses"] == "actions/download-artifact@v4" }
expect_contract(registry_verify_index, "verify-published must run registry verification")
expect_contract(registry_install_index, "verify-published must run registry install proof")
expect_contract(verify_download_index < registry_verify_index, "verify-published must download artifacts before registry verification")
expect_contract(registry_verify_index < registry_install_index, "registry verification must precede registry install proof")

release_needs = Array(github_release["needs"])
expect_contract(release_needs.include?("verify-published"), "github-release must depend on verify-published")
expect_contract(github_steps.any? { |step| step["run"].to_s.include?("gh release create") }, "github-release must create the GitHub Release only in its release job")

concurrency = workflow.fetch("concurrency")
expect_contract(concurrency["cancel-in-progress"] == false, "release concurrency must not cancel an active tag release")
expect_contract(concurrency["group"].to_s.include?("github.ref"), "release concurrency must be keyed by the exact ref")

puts JSON.generate({
  status: "PASS",
  validateUploads: validate_upload.dig("with", "name"),
  publishDownloads: publish_download.dig("with", "name"),
  verifyDownloads: verify_download.dig("with", "name"),
  verificationBeforeInstall: true,
  githubReleaseAfterVerification: true,
  noVerifyRegeneration: true,
})
