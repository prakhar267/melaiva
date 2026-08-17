#!/usr/bin/env bash

set -euo pipefail

: "${OLD_DEPLOYMENT_ID:?}"
: "${OLD_VERSION_ID:?}"
: "${OLD_VERSIONS_JSON:?}"
: "${NEW_VERSION_ID:?}"
: "${RELEASE_SHA:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_RUN_ATTEMPT:?}"

initial_settle_seconds="${MELAIVA_RECONCILE_INITIAL_SETTLE_SECONDS:-0}"
stability_observations="${MELAIVA_RECONCILE_STABILITY_OBSERVATIONS:-30}"
stability_interval_seconds="${MELAIVA_RECONCILE_STABILITY_INTERVAL_SECONDS:-2}"
[[ "${initial_settle_seconds}" =~ ^[0-9]+$ ]]
[[ "${stability_observations}" =~ ^[1-9][0-9]*$ ]]
[[ "${stability_interval_seconds}" =~ ^[1-9][0-9]*$ ]]

OLD_VERSIONS_JSON="$(jq -cS '
  if length >= 1 and length <= 2 and ([.[].percentage] | add) == 100
  then sort_by(.version_id)
  else error("captured production versions are invalid")
  end
' <<< "${OLD_VERSIONS_JSON}")"

if test "${initial_settle_seconds}" -gt 0; then
  echo "Waiting ${initial_settle_seconds}s for accepted Cloudflare mutations to become visible." >&2
  sleep "${initial_settle_seconds}"
fi

list_deployments() {
  npx wrangler deployments list --env="" --json | jq -cer 'sort_by(.created_on)'
}

stabilize_latest() {
  local expected_id="$1"
  local expected_versions="$2"
  local stable_history
  local stable_deployment
  local stability_attempt

  for ((stability_attempt = 1; stability_attempt <= stability_observations; stability_attempt += 1)); do
    sleep "${stability_interval_seconds}"
    if ! stable_history="$(list_deployments)"; then
      return 1
    fi
    stable_deployment="$(jq -cer 'last' <<< "${stable_history}")"
    if test "$(jq -er '.id' <<< "${stable_deployment}")" != "${expected_id}"; then
      return 1
    fi
    if test "$(jq -cS '.versions | sort_by(.version_id)' <<< "${stable_deployment}")" != "${expected_versions}"; then
      return 1
    fi
  done
}

write_outputs() {
  local state="$1"
  local deployment_id="$2"
  if test -n "${GITHUB_OUTPUT:-}"; then
    echo "state=${state}" >> "${GITHUB_OUTPUT}"
    echo "deployment_id=${deployment_id}" >> "${GITHUB_OUTPUT}"
  fi
  printf 'reconciled_state=%s reconciled_deployment_id=%s\n' "${state}" "${deployment_id}"
}

recovery_round=0
while true; do
  recovery_round="$((recovery_round + 1))"
  deployment_history="$(list_deployments)"
  latest_index="$(jq -er 'length - 1' <<< "${deployment_history}")"
  latest_deployment="$(jq -cer 'last' <<< "${deployment_history}")"
  latest_id="$(jq -er '.id' <<< "${latest_deployment}")"
  latest_message="$(jq -er '.annotations["workers/message"] // ""' <<< "${latest_deployment}")"
  latest_versions="$(jq -cS '.versions | sort_by(.version_id)' <<< "${latest_deployment}")"

  if [[ "${latest_message}" != *"run=${GITHUB_RUN_ID} attempt=${GITHUB_RUN_ATTEMPT}"* ]] || [[ "${latest_message}" != melaiva-release\ phase=* ]]; then
    if stabilize_latest "${latest_id}" "${latest_versions}"; then
      if test "${latest_versions}" = "${OLD_VERSIONS_JSON}"; then
        write_outputs baseline "${latest_id}"
      else
        echo "A newer unrelated deployment ${latest_id} is active; preserving it." >&2
        write_outputs unrelated "${latest_id}"
      fi
      exit 0
    fi
    continue
  fi

  [[ "${latest_index}" =~ ^[1-9][0-9]*$ ]]
  phase="$(sed -E 's/^melaiva-release phase=([^ ]+).*$/\1/' <<< "${latest_message}")"
  mode="$(sed -E 's/^.* mode=([^ ]+).*$/\1/' <<< "${latest_message}")"
  expected_predecessor_id="$(sed -E 's/^.* expected=([0-9a-f-]{36}).*$/\1/' <<< "${latest_message}")"
  [[ "${expected_predecessor_id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
  predecessor="$(jq -cer --argjson index "${latest_index}" '.[$index - 1]' <<< "${deployment_history}")"
  predecessor_id="$(jq -er '.id' <<< "${predecessor}")"

  target_mode=""
  target_versions=""
  target_deployment_id=""
  if test "${predecessor_id}" != "${expected_predecessor_id}"; then
    target_mode="preserve"
    target_versions="$(jq -cS '.versions | sort_by(.version_id)' <<< "${predecessor}")"
    target_deployment_id="${predecessor_id}"
    echo "Owned deployment ${latest_id} displaced ${predecessor_id}; restoring the displaced state." >&2
  elif test "${latest_versions}" = "${OLD_VERSIONS_JSON}"; then
    if stabilize_latest "${latest_id}" "${latest_versions}"; then
      write_outputs baseline "${latest_id}"
      exit 0
    fi
    continue
  elif { test "${phase}" = "race-recovery" || test "${phase}" = "reconcile"; } && test "${mode}" = "preserve"; then
    annotated_target_id="$(sed -E 's/^.* target=([0-9a-f-]{36}).*$/\1/' <<< "${latest_message}")"
    if [[ "${annotated_target_id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
      target_deployment_id="${annotated_target_id}"
    else
      test "${latest_index}" -ge 2
      target_deployment_id="$(jq -er --argjson index "${latest_index}" '.[$index - 2].id' <<< "${deployment_history}")"
    fi
    displaced_deployment="$(jq -cer --arg target "${target_deployment_id}" '[.[] | select(.id == $target)] | last' <<< "${deployment_history}")"
    displaced_versions="$(jq -cS '.versions | sort_by(.version_id)' <<< "${displaced_deployment}")"
    if test "${latest_versions}" = "${displaced_versions}"; then
      if stabilize_latest "${latest_id}" "${latest_versions}"; then
        write_outputs preserved "${latest_id}"
        exit 0
      fi
      continue
    fi
    target_mode="preserve"
    target_versions="${displaced_versions}"
    echo "Owned recovery ${latest_id} did not reproduce target ${target_deployment_id}; correcting it." >&2
  elif test "${phase}" = "zero"; then
    jq -e --arg old "${OLD_VERSION_ID}" --arg new "${NEW_VERSION_ID}" '
      ([.versions[] | select(.version_id == $old and .percentage == 100)] | length) == 1 and
      ([.versions[] | select(.version_id == $new and .percentage == 0)] | length) == 1 and
      ([.versions[] | select(.version_id != $old and .version_id != $new)] | length) == 0
    ' <<< "${latest_deployment}" >/dev/null
    target_mode="baseline"
    target_versions="${OLD_VERSIONS_JSON}"
    target_deployment_id="${OLD_DEPLOYMENT_ID}"
  elif test "${phase}" = "cutover"; then
    jq -e --arg new "${NEW_VERSION_ID}" '
      ([.versions[] | select(.version_id == $new and .percentage == 100)] | length) == 1 and
      ([.versions[] | select(.version_id != $new or .percentage != 100)] | length) == 0
    ' <<< "${latest_deployment}" >/dev/null
    target_mode="baseline"
    target_versions="${OLD_VERSIONS_JSON}"
    target_deployment_id="${OLD_DEPLOYMENT_ID}"
  elif test "${phase}" = "reconcile" && test "${mode}" = "baseline"; then
    target_mode="baseline"
    target_versions="${OLD_VERSIONS_JSON}"
    target_deployment_id="${OLD_DEPLOYMENT_ID}"
    echo "Owned baseline reconciliation ${latest_id} did not reproduce the captured state; correcting it." >&2
  else
    echo "Refusing to reconcile an unknown owned deployment phase." >&2
    exit 1
  fi

  target_versions="$(jq -cS '
    if length >= 1 and length <= 2 and ([.[].percentage] | add) == 100
    then sort_by(.version_id)
    else error("reconcile target versions are invalid")
    end
  ' <<< "${target_versions}")"
  [[ "${target_deployment_id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
  target_specs=()
  while IFS= read -r target_spec; do
    target_specs+=("${target_spec}")
  done < <(jq -r '.[] | "\(.version_id)@\(.percentage)"' <<< "${target_versions}")
  reconcile_message="melaiva-release phase=reconcile mode=${target_mode} expected=${latest_id} target=${target_deployment_id} sha=${RELEASE_SHA} run=${GITHUB_RUN_ID} attempt=${GITHUB_RUN_ATTEMPT} round=${recovery_round}"
  npx wrangler versions deploy --env="" --yes "${target_specs[@]}" --message "${reconcile_message}"

  propagation_attempt=0
  while true; do
    propagation_attempt="$((propagation_attempt + 1))"
    observed_history="$(list_deployments)"
    observed_id="$(jq -r --arg message "${reconcile_message}" '[.[] | select(.annotations["workers/message"] == $message)] | last? | .id? // empty' <<< "${observed_history}")"
    if test -z "${observed_id}"; then
      if test "$((propagation_attempt % 15))" -eq 0; then
        echo "Waiting for reconcile mutation ${reconcile_message} to become observable." >&2
      fi
      sleep 2
      continue
    fi
    observed_index="$(jq -er --arg id "${observed_id}" 'map(.id) | index($id)' <<< "${observed_history}")"
    observed_latest_id="$(jq -er 'last | .id' <<< "${observed_history}")"
    if test "${observed_latest_id}" != "${observed_id}"; then
      break
    fi
    [[ "${observed_index}" =~ ^[1-9][0-9]*$ ]]
    observed_predecessor_id="$(jq -er --argjson index "${observed_index}" '.[$index - 1].id' <<< "${observed_history}")"
    observed_versions="$(jq -cS --argjson index "${observed_index}" '.[$index].versions | sort_by(.version_id)' <<< "${observed_history}")"
    if test "${observed_predecessor_id}" != "${latest_id}" || test "${observed_versions}" != "${target_versions}"; then
      break
    fi
    if stabilize_latest "${observed_id}" "${observed_versions}"; then
      if test "${target_mode}" = "baseline"; then
        write_outputs baseline "${observed_id}"
      else
        write_outputs preserved "${observed_id}"
      fi
      exit 0
    fi
    break
  done
done
