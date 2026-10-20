# Authentication observation only; later root copying must authenticate its own copy.
exec 9>&2 2>/dev/null
entry_flags=$-
refuse() { builtin printf 'installer authentication refused: %s\n' "$1" >&9; exit 1; }
set -f -E -o pipefail
trap 'refuse command' ERR
SECONDS=0
deadline() { (( SECONDS >= 0 && SECONDS < 60 )) || refuse deadline; }
decimal() { case "$1" in ''|*[!0-9]*|0*) return 1;; esac; (( ${#1} <= 10 && 10#$1 <= 2147483647 )); }
digest() { [[ ${#1} == 64 && "$1" != *[!0-9a-f]* ]]; }
[[ $# == 7 && "$1" == --ci-owned && "$2" == 00000000-0000-0000-0000-000000000003 ]] || refuse arguments
op_uid=$3 capture_uid=$4 base=$5 expected_installer=$6 expected_manifest=$7
decimal "$op_uid" && decimal "$capture_uid" || refuse roles
[[ "$UID" == "$op_uid" && "$EUID" == "$op_uid" && "$op_uid" != "$capture_uid" ]] || refuse roles
[[ "$CI" == true && "$GITHUB_ACTIONS" == true && "$LC_ALL" == C && "$entry_flags" == *p* && "$entry_flags" == *f* ]] || refuse environment
digest "$expected_installer" && digest "$expected_manifest" || refuse approvals
[[ ${#base} -le 4096 && "$base" == /* && "$base" != */ && "$base" != *//* && "$base" != *[!a-zA-Z0-9_./-]* ]] || refuse path
[[ "${base##*/}" == openclaw-stage0-auth-owned-* && "$0" == "$base/stage0_installer_auth.sh" ]] || refuse fixture
cd / || refuse cwd
environment=$(/usr/bin/env | /usr/bin/head -c 4097) || refuse environment
[[ ${#environment} -le 4096 ]] || refuse environment
while IFS='=' read -r key value; do
    case "$key" in CI|GITHUB_ACTIONS|LC_ALL|PWD|OLDPWD|SHLVL|_) ;; *) refuse environment;; esac
done <<< "$environment"
[[ "$PWD" == / && "$OLDPWD" == / && "$SHLVL" == 1 ]] || refuse environment
start=
IFS= read -r -n 64 -t 10 start || refuse rendezvous
[[ "$start" == openclaw-stage0-owned-start-v1 ]] || refuse rendezvous
extra=
if IFS= read -r -n 1 extra; then refuse rendezvous; else eof_status=$?; fi
[[ $eof_status == 1 && -z "$extra" ]] || refuse rendezvous
platform=$(/usr/bin/uname -s) || refuse platform
case "$platform" in Darwin) ls_tool=/bin/ls;; Linux) ls_tool=/usr/bin/ls;; *) refuse platform;; esac

bounded() {
    deadline
    captured=$("$@" | /usr/bin/head -c 4097 && builtin printf '.') || refuse metadata
    captured=${captured%.}
    [[ ${#captured} -le 4096 ]] || refuse metadata
    deadline
    builtin printf '%s' "$captured"
}
metadata() {
    if [[ "$platform" == Darwin ]]; then
        if [[ $# == 0 ]]; then
            bounded /usr/bin/stat -f '%d %i %p %u %g %l %z %m %c %B %f'
        else
            bounded /usr/bin/stat -f '%d %i %p %u %g %l %z %m %c %B %f' "$1"
        fi
    else
        if [[ $# == 0 ]]; then
            bounded /usr/bin/stat -L -c '%d %i %f %u %g %h %s %Y %Z %W 0 %y %z' /proc/self/fd/0
        else
            bounded /usr/bin/stat -c '%d %i %f %u %g %h %s %Y %Z %W 0 %y %z' "$1"
        fi
    fi
}
shape() {
    local record=$1 kind=$2 private=$3 dev ino mode uid gid links size mt ct birth flags rest number
    read -r dev ino mode uid gid links size mt ct birth flags rest <<< "$record"
    for number in "$dev" "$ino" "$uid" "$gid" "$links" "$size" "$mt" "$ct" "$birth" "$flags"; do
        [[ -n "$number" && "$number" != *[!0-9]* && ${#number} -le 20 ]] || refuse metadata
    done
    [[ -n "$mode" && ${#mode} -le 8 ]] || refuse metadata
    if [[ "$platform" == Darwin ]]; then
        [[ "$mode" != *[!0-7]* && -z "$rest" ]] || refuse metadata
        number=$((8#$mode))
    else
        [[ "$mode" != *[!0-9a-f]* && -n "$rest" ]] || refuse metadata
        number=$((16#$mode))
    fi
    [[ "$uid" == 0 || "$uid" == "$op_uid" ]] || refuse owner
    (( (number & 0022) == 0 )) || refuse writable
    if [[ "$kind" == directory ]]; then
        (( (number & 0170000) == 0040000 )) || refuse type
        if [[ "$private" == yes ]]; then
            [[ "$uid" == "$op_uid" && "$flags" == 0 ]] && (( (number & 07777) == 0700 )) || refuse private
        fi
    else
        [[ "$uid" == "$op_uid" && "$links" == 1 && "$flags" == 0 ]] || refuse private
        (( (number & 0170000) == 0100000 && (number & 07777) == 0600 )) || refuse type
        (( size > 0 && size <= private )) || refuse size
    fi
}
attributes() {
    local path=$1 private=$2 acl names line attributes suffix count=0
    if [[ "$platform" == Darwin ]]; then
        acl=$(bounded "$ls_tool" -lde "$path") || refuse acl
        if [[ "$acl" == *$'\n'* ]]; then
            acl=${acl#*$'\n'}
            [[ "$private" == no ]] || refuse acl
            while IFS= read -r line; do
                [[ "$line" =~ ^[[:space:]]*[0-9]+:\ (user|group):[a-zA-Z0-9_-]+\ deny\ [a-z_,]+$ ]] || refuse acl
            done <<< "$acl"
        else acl=; fi
        names=$(bounded /usr/bin/xattr -s "$path") || refuse xattrs
        [[ "$private" == no || -z "$names" ]] || refuse xattrs
        builtin printf '%s|%s' "$acl" "$names"
    else
        acl=$(bounded /usr/bin/getfacl -cpn --absolute-names "$path") || refuse acl
        while IFS= read -r line; do
            case "$line" in user::[r-][w-][x-]|group::[r-][w-][x-]|other::[r-][w-][x-]) ((count+=1));; *) refuse acl;; esac
        done <<< "$acl"
        [[ $count == 3 ]] || refuse acl
        names=$(bounded /usr/bin/getfattr -m - --absolute-names "$path") || refuse xattrs
        [[ "$private" == no || -z "$names" ]] || refuse xattrs
        attributes=$(bounded /usr/bin/lsattr -d "$path") || refuse flags
        suffix=${attributes#* }
        attributes=${attributes%% *}
        [[ -n "$attributes" && ${#attributes} -le 32 && "$attributes" != *[!e-]* && -n "$suffix" ]] || refuse flags
        builtin printf '%s|%s|%s' "$acl" "$names" "$attributes"
    fi
}
paths=() records=() attrs=()
path=/ depth=0
parts=${base#/}
while :; do
    [[ $depth -lt 64 ]] || refuse depth
    if [[ "$path" == "$base" ]]; then private=yes; else private=no; fi
    record=$(metadata "$path") || refuse metadata
    [[ ! -L "$path" ]] || refuse link
    shape "$record" directory "$private"
    exec 6< "$path" || refuse open
    [[ "$(metadata <&6)" == "$record" ]] || refuse mapping
    attribute=$(attributes "$path" "$private") || refuse attributes
    [[ "$(metadata "$path")" == "$record" && "$(metadata <&6)" == "$record" ]] || refuse mapping
    exec 6<&-
    paths+=("$path") records+=("$record") attrs+=("$attribute")
    ((depth+=1))
    [[ "$path" == "$base" ]] && break
    component=${parts%%/*}
    [[ -n "$component" && "$component" != . && "$component" != .. ]] || refuse path
    if [[ "$path" == / ]]; then path=/$component; else path=$path/$component; fi
    if [[ "$parts" == */* ]]; then parts=${parts#*/}; else parts=; fi
done
manifest=$base/installer.manifest
installer=$base/host_release_publish.py
script=$base/stage0_installer_auth.sh
manifest_record=$(metadata "$manifest") || refuse metadata
installer_record=$(metadata "$installer") || refuse metadata
script_record=$(metadata "$script") || refuse metadata
for item in manifest installer script; do
    case "$item" in manifest) file=$manifest; record=$manifest_record; maximum=512;; installer) file=$installer; record=$installer_record; maximum=131072;; script) file=$script; record=$script_record; maximum=65536;; esac
    [[ ! -L "$file" ]] || refuse link
    shape "$record" file "$maximum"
    [[ -n "$(attributes "$file" yes)" ]] || refuse attributes
done
exec 3< "$manifest" 4< "$installer" 5< "$script" || refuse open
manifest_attrs=$(attributes "$manifest" yes) || refuse attributes
installer_attrs=$(attributes "$installer" yes) || refuse attributes
script_attrs=$(attributes "$script" yes) || refuse attributes
mapping() {
    [[ ! -L "$1" && "$(metadata "$1")" == "$2" && "$(metadata <&"$3")" == "$2" ]] || refuse mapping
}
hash_stdin() {
    local hash
    if [[ "$platform" == Darwin ]]; then
        hash=$(/usr/bin/openssl dgst -sha256 && builtin printf '.') || refuse digest
        [[ "$hash" == *$'\n.' ]] || refuse digest
        hash=${hash%$'\n.'}
    else
        hash=$(/usr/bin/sha256sum && builtin printf '.') || refuse digest
        [[ "$hash" == *$'  -\n.' ]] || refuse digest
        hash=${hash%$'  -\n.'}
    fi
    digest "$hash" || refuse digest
    builtin printf '%s' "$hash"
}
hash_path() {
    local file=$1 original=$2 fd=$3 maximum=$4 hash
    deadline
    mapping "$file" "$original" "$fd"
    exec 7< "$file" || refuse open
    [[ "$(metadata <&7)" == "$original" ]] || refuse mapping
    hash=$(/usr/bin/head -c "$((maximum+1))" <&7 | hash_stdin) || refuse digest
    [[ "$(metadata <&7)" == "$original" ]] || refuse mapping
    exec 7<&-
    mapping "$file" "$original" "$fd"
    deadline
    builtin printf '%s' "$hash"
}
[[ "$(hash_path "$manifest" "$manifest_record" 3 512)" == "$expected_manifest" ]] || refuse manifest-approval
mapping "$manifest" "$manifest_record" 3
raw=$(/usr/bin/head -c 513 "$manifest" && builtin printf '.') || refuse parse
raw=${raw%.}
mapping "$manifest" "$manifest_record" 3
fields=()
for field in schema name size hash; do
    [[ "$raw" == *$'\n'* ]] || refuse schema
    fields+=("${raw%%$'\n'*}")
    raw=${raw#*$'\n'}
done
[[ -z "$raw" && "${fields[0]}" == openclaw-installer-v1 && "${fields[1]}" == host_release_publish.py ]] || refuse schema
decimal "${fields[2]}" && (( 10#${fields[2]} <= 131072 )) || refuse schema
digest "${fields[3]}" || refuse schema
canonical=$(builtin printf '%s\n' "${fields[@]}" | hash_stdin) || refuse digest
[[ "$canonical" == "$expected_manifest" ]] || refuse canonical
[[ "${fields[3]}" == "$expected_installer" ]] || refuse installer-approval
read -r unused unused unused unused unused unused observed_size unused <<< "$installer_record"
[[ "${fields[2]}" == "$observed_size" ]] || refuse installer-size
[[ "$(hash_path "$installer" "$installer_record" 4 131072)" == "$expected_installer" ]] || refuse installer-bytes
expected_entries=$'host_release_publish.py\ninstaller.manifest\nstage0_installer_auth.sh'
[[ "$(bounded "$ls_tool" -A1 "$base")" == "$expected_entries" ]] || refuse entries
for ((index=0; index<depth; index++)); do
    deadline
    path=${paths[index]}
    if [[ "$path" == "$base" ]]; then private=yes; else private=no; fi
    [[ ! -L "$path" && "$(metadata "$path")" == "${records[index]}" && "$(attributes "$path" "$private")" == "${attrs[index]}" ]] || refuse ancestor-drift
done
[[ "$(attributes "$manifest" yes)" == "$manifest_attrs" && "$(attributes "$installer" yes)" == "$installer_attrs" && "$(attributes "$script" yes)" == "$script_attrs" ]] || refuse attribute-drift
[[ "$(hash_path "$manifest" "$manifest_record" 3 512)" == "$expected_manifest" ]] || refuse final-manifest
[[ "$(hash_path "$installer" "$installer_record" 4 131072)" == "$expected_installer" ]] || refuse final-installer
mapping "$script" "$script_record" 5
deadline
builtin printf 'installer-auth-observed-v1\n'
