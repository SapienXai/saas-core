require "json"
require "yaml"

RELEASE_WORKFLOW = File.expand_path("../.github/workflows/release-saas-core.yml", __dir__)
QUALITY_WORKFLOW = File.expand_path("../.github/workflows/quality.yml", __dir__)

def fail_contract(message)
  warn "Workflow contract failure: #{message}"
  exit 1
end

def expect_contract(condition, message)
  fail_contract(message) unless condition
end

workflow = YAML.load_file(RELEASE_WORKFLOW)
for workflow_path in [RELEASE_WORKFLOW, QUALITY_WORKFLOW]
  scoped_workflow = YAML.load_file(workflow_path)
  global_environment = scoped_workflow.fetch("env", {})
  forbidden_global_keys = %w[
    SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY SUPABASE_JWT_SECRET
    NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
    NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_APP_URL SAAS_CORE_ROOT_DOMAIN SAAS_CORE_APP_DOMAIN
    SAAS_CORE_APP_URL NEXT_PUBLIC_SAAS_CORE_APP_DOMAIN SAAS_CORE_RATE_LIMIT_SECRET
    SAAS_CORE_API_CREDENTIAL_PEPPER CRON_SECRET STRIPE_ENVIRONMENT STRIPE_SECRET_KEY
    PADDLE_API_KEY PADDLE_WEBHOOK_SECRET NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
    STRIPE_WEBHOOK_SECRET STRIPE_ACCOUNT_ID STRIPE_BILLING_PORTAL_CONFIGURATION_ID
  ]
  leaked_keys = forbidden_global_keys.select { |key| global_environment.key?(key) }
  expect_contract(leaked_keys.empty?, "#{File.basename(workflow_path)} must not globally inject runtime/test environment: #{leaked_keys.join(", ")}")
end
quality = YAML.load_file(QUALITY_WORKFLOW)
quality_events = quality["on"] || quality[true]
expect_contract(quality_events.dig("pull_request", "types").include?("labeled"), "release candidate label must start PR checks")
expect_contract(quality_events.dig("push", "branches") == ["main"] && quality_events.key?("schedule"), "main and scheduled checks must remain enabled")
expect_contract(quality["permissions"] == { "contents" => "read" }, "quality checks must remain read-only")
quality_jobs = quality.fetch("jobs")
full = quality_jobs.fetch("e2e-full")
expect_contract(full["needs"] == "release-quality", "full browsers must depend on release quality")
expect_contract(full["if"].include?("head.repo.full_name == github.repository") && full["if"].include?("'release-candidate'"), "full PR browser coverage must require a labeled same-repository PR")
quality_jobs.each_value do |job|
  checkout = job.fetch("steps").find { |step| step["uses"] == "actions/checkout@v4" }
  expect_contract(checkout.dig("with", "ref").include?("head.sha") && checkout.dig("with", "persist-credentials") == false, "quality checks must verify candidate head without keeping checkout credentials")
  expect_contract(job.fetch("steps").none? { |step| step["run"].to_s.include?("release:publish") }, "quality checks cannot publish artifacts")
end

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

integration_runner = File.read(File.expand_path("run-local-supabase-tests.mjs", __dir__))
Dir[File.expand_path("../test/*.integration.test.ts", __dir__)].each do |integration_file|
  expect_contract(integration_runner.include?(File.basename(integration_file)), "local integration runner must explicitly include #{File.basename(integration_file)}")
end

expect_contract(File.read(File.expand_path("release-check.mjs", __dir__)).include?("release:environment"), "release-check must run the poison-environment isolation proof")
expect_contract(File.read(File.expand_path("run-release-unit-tests.mjs", __dir__)).include?("createReleaseUnitEnvironment"), "release unit tests must sanitize their parent environment")
expect_contract(File.read(File.expand_path("run-local-supabase-tests.mjs", __dir__)).include?("55621"), "local integration tests must enforce the isolated Supabase port")
expect_contract(File.read(File.expand_path("run-local-playwright.mjs", __dir__)).include?("createLocalE2EEnvironment"), "browser E2E must use the local Supabase environment helper")
expect_contract(File.read(File.expand_path("release-environment.mjs", __dir__)).include?("source.SAAS_CORE_FULL_E2E === \"1\""), "full browser E2E must preserve only its explicit full-suite selector")

quality_jobs = YAML.load_file(QUALITY_WORKFLOW).fetch("jobs")
quality_uploads = quality_jobs.values.flat_map { |job| Array(job["steps"]) }.select { |step| step["uses"] == "actions/upload-artifact@v4" }
expect_contract(quality_uploads.length == 2, "quality workflow must retain both Playwright artifact uploads")
expect_contract(quality_uploads.all? { |step| step["continue-on-error"] == true }, "quality artifact storage exhaustion must not turn a passing validation gate into a failure")

package_scripts = JSON.parse(File.read(File.expand_path("../package.json", __dir__))).fetch("scripts")
expect_contract(!package_scripts.fetch("e2e:full").to_s.match?(/--grep\s+@e2e/), "e2e:full must not select a nonexistent @e2e tag")

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
