exec 9>&2 2>/dev/null
entry_flags=$-
refuse() { builtin printf 'installer authentication refused: %s\n' "$1" >&9; exit 1; }
set -f -E -o pipefail
trap 'refuse command' ERR
SECONDS=0
deadline() { (( SECONDS >= 0 && SECONDS < 60 )) || refuse deadline; }
decimal() { case "$1" in ''|*[!0-9]*|0*) return 1;; esac; (( ${#1} <= 10 && 10#$1 <= 2147483647 )); }
digest() { [[ ${#1} == 64 && "$1" != *[!0-9a-f]* ]]; }
[[ $# == 8 && "$1" == --ci-owned-root-copy && "$2" == 00000000-0000-0000-0000-000000000003 ]] || refuse arguments
op_uid=$3 capture_uid=$4 base=$5 root=$6 expected_installer=$7 expected_manifest=$8
decimal "$op_uid" && decimal "$capture_uid" || refuse roles
[[ "$UID" == 0 && "$EUID" == 0 && "$op_uid" != "$capture_uid" ]] || refuse roles
[[ "$CI" == true && "$GITHUB_ACTIONS" == true && "$LC_ALL" == C && "$entry_flags" == *p* && "$entry_flags" == *f* ]] || refuse environment
digest "$expected_installer" && digest "$expected_manifest" || refuse approvals
for path in "$base" "$root"; do
    [[ ${#path} -le 4096 && "$path" == /* && "$path" != */ && "$path" != *//* && "$path" != *[!a-zA-Z0-9_./-]* ]] || refuse path
done
[[ "${base##*/}" == openclaw-stage0-copy-input-owned-* && "${root##*/}" == openclaw-stage0-copy-root-owned-* && "$0" == "$root/stage0_installer_copy.sh" ]] || refuse fixture
[[ "$base" != "$root" && "$base" != "$root"/* && "$root" != "$base"/* ]] || refuse overlap
cd / || refuse cwd
environment=$(/usr/bin/env | /usr/bin/head -c 4097) || refuse environment
[[ ${#environment} -le 4096 ]] || refuse environment
while [[ -n "$environment" ]]; do
    if [[ "$environment" == *$'\n'* ]]; then line=${environment%%$'\n'*}; environment=${environment#*$'\n'}; else line=$environment; environment=; fi
    [[ "$line" == *=* ]] || refuse environment
    key=${line%%=*}
    case "$key" in CI|GITHUB_ACTIONS|LC_ALL|PWD|OLDPWD|SHLVL|_) ;; *) refuse environment;; esac
done
[[ "$PWD" == / && "$OLDPWD" == / && "$SHLVL" == 1 ]] || refuse environment
start=
IFS= read -r -n 64 -t 10 start || refuse rendezvous
[[ "$start" == openclaw-stage0-owned-start-v1 ]] || refuse rendezvous
extra=
if IFS= read -r -n 1 extra; then refuse rendezvous; else eof_status=$?; fi
[[ $eof_status == 1 && -z "$extra" ]] || refuse rendezvous
platform=$(/usr/bin/uname -s) || refuse platform
case "$platform" in Darwin) ls_tool=/bin/ls; mkdir_tool=/bin/mkdir;; Linux) ls_tool=/usr/bin/ls; mkdir_tool=/usr/bin/mkdir;; *) refuse platform;; esac
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
    local IFS=$' \t\n'
    set -- $record
    if [[ "$platform" == Darwin ]]; then [[ $# == 11 ]]; else [[ $# == 17 ]]; fi || refuse metadata
    dev=$1 ino=$2 mode=$3 uid=$4 gid=$5 links=$6 size=$7 mt=$8 ct=$9
    shift 9
    birth=$1 flags=$2
    shift 2
    rest=$*
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
    local path=$1 private=$2 acl names line attributes suffix remaining count=0
    if [[ "$platform" == Darwin ]]; then
        acl=$(bounded "$ls_tool" -lde "$path") || refuse acl
        if [[ "$acl" == *$'\n'* ]]; then
            acl=${acl#*$'\n'}
            [[ "$private" == no ]] || refuse acl
            remaining=$acl
            while [[ -n "$remaining" ]]; do
                if [[ "$remaining" == *$'\n'* ]]; then line=${remaining%%$'\n'*}; remaining=${remaining#*$'\n'}; else line=$remaining; remaining=; fi
                [[ "$line" =~ ^[[:space:]]*[0-9]+:\ (user|group):[a-zA-Z0-9_-]+\ deny\ [a-z_,]+$ ]] || refuse acl
            done
        else acl=; fi
        names=$(bounded /usr/bin/xattr -s "$path") || refuse xattrs
        [[ "$private" == no || -z "$names" ]] || refuse xattrs
        builtin printf '%s|%s' "$acl" "$names"
    else
        acl=$(bounded /usr/bin/getfacl -cpn --absolute-names "$path") || refuse acl
        remaining=$acl
        while [[ -n "$remaining" ]]; do
            if [[ "$remaining" == *$'\n'* ]]; then line=${remaining%%$'\n'*}; remaining=${remaining#*$'\n'}; else line=$remaining; remaining=; fi
            case "$line" in user::[r-][w-][x-]|group::[r-][w-][x-]|other::[r-][w-][x-]) ((count+=1));; *) refuse acl;; esac
        done
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

root_shape() { local op_uid=0; shape "$@"; }
paths=() records=() attrs=() privates=()
inspect_tree() {
    local target=$1 op_uid=$2 path=/ parts=${1#/} depth=0 private record attribute component
    while :; do
        [[ $depth -lt 64 ]] || refuse depth
        if [[ "$path" == "$target" ]]; then private=yes; else private=no; fi
        record=$(metadata "$path") || refuse metadata
        [[ ! -L "$path" ]] || refuse link
        shape "$record" directory "$private"
        exec 6< "$path" || refuse open
        [[ "$(metadata <&6)" == "$record" ]] || refuse mapping
        attribute=$(attributes "$path" "$private") || refuse attributes
        [[ "$(metadata "$path")" == "$record" && "$(metadata <&6)" == "$record" ]] || refuse mapping
        exec 6<&-
        paths+=("$path") records+=("$record") attrs+=("$attribute") privates+=("$private")
        ((depth+=1))
        [[ "$path" == "$target" ]] && break
        component=${parts%%/*}
        [[ -n "$component" && "$component" != . && "$component" != .. ]] || refuse path
        if [[ "$path" == / ]]; then path=/$component; else path=$path/$component; fi
        if [[ "$parts" == */* ]]; then parts=${parts#*/}; else parts=; fi
    done
    leaf_index=$((${#paths[@]}-1))
}
check_trees() {
    local index path
    [[ -z "$pending" ]] || root_entries
    for ((index=0; index<${#paths[@]}; index++)); do
        deadline
        path=${paths[index]}
        [[ ! -L "$path" && "$(metadata "$path")" == "${records[index]}" && "$(attributes "$path" "${privates[index]}")" == "${attrs[index]}" ]] || refuse ancestor-drift
    done
}
root_entries() {
    [[ "$(bounded "$ls_tool" -A1 "$root" 12>&-)" == "$pending"$'\nstage0_installer_copy.sh' ]] || refuse root-entries
}
record_size() {
    local IFS=$' \t\n'
    set -- $1
    if [[ "$platform" == Darwin ]]; then [[ $# == 11 ]]; else [[ $# == 17 ]]; fi || refuse metadata
    builtin printf '%s' "$7"
}
verify_pair() {
    local manifest=$1 manifest_record=$2 manifest_fd=$3 installer=$4 installer_record=$5 installer_fd=$6 raw field canonical observed_size
    local -a fields
    [[ "$(hash_path "$manifest" "$manifest_record" "$manifest_fd" 512)" == "$expected_manifest" ]] || refuse manifest-approval
    mapping "$manifest" "$manifest_record" "$manifest_fd"
    raw=$(/usr/bin/head -c 513 "$manifest" && builtin printf '.') || refuse parse
    raw=${raw%.}
    mapping "$manifest" "$manifest_record" "$manifest_fd"
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
    observed_size=$(record_size "$installer_record")
    [[ "${fields[2]}" == "$observed_size" ]] || refuse installer-size
    [[ "$(hash_path "$installer" "$installer_record" "$installer_fd" 131072)" == "$expected_installer" ]] || refuse installer-bytes
}
stable_record() {
    local record=$1 kind=$2 IFS=$' \t\n'
    set -- $record
    if [[ "$platform" == Darwin ]]; then [[ $# == 11 ]]; else [[ $# == 17 ]]; fi || refuse metadata
    builtin printf '%s %s %s %s %s %s %s' "$1" "$2" "$3" "$4" "$5" "${10}" "${11}"
    if [[ "$kind" == file || ( "$kind" == child && "$platform" != Darwin ) ]]; then builtin printf ' %s' "$6"; fi
}
transition() {
    local path=$1 fd=$2 previous=$3 previous_attrs=$4 kind=$5 now
    now=$(metadata "$path" 12>&-) || refuse metadata
    [[ ! -L "$path" && "$(metadata <&"$fd" 12>&-)" == "$now" ]] || refuse mapping
    [[ "$(stable_record "$previous" "$kind" 12>&-)" == "$(stable_record "$now" "$kind" 12>&-)" ]] || refuse transition
    [[ "$(attributes "$path" yes 12>&-)" == "$previous_attrs" ]] || refuse attribute-drift
    root_shape "$now" directory yes
    transition_record=$now
}
empty_file() {
    local path=$1 fd=$2 record mode number field IFS=$' \t\n'
    record=$(metadata "$path" 12>&-) || refuse metadata
    [[ ! -L "$path" && "$(metadata <&"$fd" 12>&-)" == "$record" ]] || refuse mapping
    set -- $record
    if [[ "$platform" == Darwin ]]; then [[ $# == 11 ]]; else [[ $# == 17 ]]; fi || refuse metadata
    mode=$3
    for field in "$1" "$2" "$4" "$5" "$6" "$7" "$8" "$9" "${10}" "${11}"; do
        [[ -n "$field" && "$field" != *[!0-9]* && ${#field} -le 20 ]] || refuse metadata
    done
    [[ "$4" == 0 && "$6" == 1 && "$7" == 0 && "${11}" == 0 && ${#mode} -le 8 && -n "$mode" ]] || refuse empty-file
    if [[ "$platform" == Darwin ]]; then [[ "$mode" != *[!0-7]* ]] || refuse metadata; number=$((8#$mode)); else [[ "$mode" != *[!0-9a-f]* ]] || refuse metadata; number=$((16#$mode)); fi
    (( (number & 0170000) == 0100000 && (number & 07777) == 0600 )) || refuse empty-file
    empty_attrs=$(attributes "$path" yes 12>&-) || refuse attributes
    [[ "$(metadata "$path" 12>&-)" == "$record" && "$(metadata <&"$fd" 12>&-)" == "$record" ]] || refuse mapping
    empty_record=$record
}
copy_file() {
    local name=$1 source=$2 original=$3 source_fd=$4 cap=$5 before after read_fd=$6
    check_trees
    [[ "$(metadata .)" == "$child_record" && "$(metadata <&11)" == "$child_record" && "$(attributes . yes)" == "$child_attrs" ]] || refuse child-drift
    [[ "$(bounded "$ls_tool" -A1 .)" == "$child_entries" ]] || refuse child-entries
    mapping "$source" "$original" "$source_fd"
    exec 12> "$name" || refuse create-file
    transition "$child" 11 "$child_record" "$child_attrs" child
    child_record=$transition_record
    empty_file "$child/$name" 12
    before=$empty_record
    /usr/bin/head -c "$((cap+1))" <&"$source_fd" >&12 || refuse copy
    if [[ "$read_fd" == 6 ]]; then exec 6< "$name" || refuse open; else exec 8< "$name" || refuse open; fi
    [[ "$(metadata <&"$read_fd" 12>&-)" == "$(metadata <&12 12>&-)" ]] || refuse mapping
    exec 12>&-
    after=$(metadata "$child/$name") || refuse metadata
    mapping "$child/$name" "$after" "$read_fd"
    root_shape "$after" file "$cap"
    [[ "$(stable_record "$before" file)" == "$(stable_record "$after" file)" ]] || refuse transition
    [[ "$(attributes "$child/$name" yes)" == "$empty_attrs" ]] || refuse attribute-drift
    mapping "$source" "$original" "$source_fd"
    [[ "$(metadata .)" == "$child_record" && "$(metadata <&11)" == "$child_record" && "$(attributes . yes)" == "$child_attrs" ]] || refuse child-drift
    copied_record=$after
}
inspect_tree "$root" 0
root_index=$leaf_index
inspect_tree "$base" "$op_uid"
manifest=$base/installer.manifest
installer=$base/host_release_publish.py
script=$root/stage0_installer_copy.sh
manifest_record=$(metadata "$manifest") || refuse metadata
installer_record=$(metadata "$installer") || refuse metadata
script_record=$(metadata "$script") || refuse metadata
for item in manifest installer script; do
    case "$item" in manifest) file=$manifest; record=$manifest_record; maximum=512;; installer) file=$installer; record=$installer_record; maximum=131072;; script) file=$script; record=$script_record; maximum=65536;; esac
    [[ ! -L "$file" ]] || refuse link
    if [[ "$item" == script ]]; then root_shape "$record" file "$maximum"; else shape "$record" file "$maximum"; fi
    [[ -n "$(attributes "$file" yes)" ]] || refuse attributes
done
exec 3< "$manifest" 4< "$installer" 5< "$script" 10< "$root" || refuse open
manifest_attrs=$(attributes "$manifest" yes) || refuse attributes
installer_attrs=$(attributes "$installer" yes) || refuse attributes
script_attrs=$(attributes "$script" yes) || refuse attributes
mapping "$script" "$script_record" 5
[[ "$(bounded "$ls_tool" -A1 "$base")" == $'host_release_publish.py\ninstaller.manifest' ]] || refuse entries
[[ "$(bounded "$ls_tool" -A1 "$root")" == stage0_installer_copy.sh ]] || refuse root-entries
verify_pair "$manifest" "$manifest_record" 3 "$installer" "$installer_record" 4
check_trees
builtin cd -P -- "$root" || refuse cwd
[[ "$(metadata .)" == "${records[root_index]}" && "$(metadata <&10)" == "${records[root_index]}" ]] || refuse mapping
pending=pending-installer-$expected_manifest
child=$root/$pending
umask 077
set -C
"$mkdir_tool" -m 700 -- "$pending" || refuse staging-fence
transition "$root" 10 "${records[root_index]}" "${attrs[root_index]}" root
records[root_index]=$transition_record
root_entries
child_record=$(metadata "$child") || refuse metadata
[[ ! -L "$child" ]] || refuse link
root_shape "$child_record" directory yes
[[ "${child_record%% *}" == "${records[root_index]%% *}" ]] || refuse device
exec 11< "$child" || refuse open
[[ "$(metadata <&11)" == "$child_record" ]] || refuse mapping
child_attrs=$(attributes "$child" yes) || refuse attributes
builtin cd -P -- "$pending" || refuse cwd
[[ "$(metadata .)" == "$child_record" && "$(bounded "$ls_tool" -A1 .)" == '' ]] || refuse child-entries
child_entries=
copy_file installer.manifest "$manifest" "$manifest_record" 3 512 6
copied_manifest_record=$copied_record
child_entries=installer.manifest
copy_file host_release_publish.py "$installer" "$installer_record" 4 131072 8
copied_installer_record=$copied_record
child_entries=$'host_release_publish.py\ninstaller.manifest'
[[ "$(bounded "$ls_tool" -A1 .)" == "$child_entries" ]] || refuse child-entries
verify_pair "$child/installer.manifest" "$copied_manifest_record" 6 "$child/host_release_publish.py" "$copied_installer_record" 8
check_trees
[[ "$(metadata .)" == "$child_record" && "$(metadata <&11)" == "$child_record" && "$(attributes . yes)" == "$child_attrs" ]] || refuse child-drift
[[ "$(attributes "$manifest" yes)" == "$manifest_attrs" && "$(attributes "$installer" yes)" == "$installer_attrs" && "$(attributes "$script" yes)" == "$script_attrs" ]] || refuse attribute-drift
[[ "$(hash_path "$manifest" "$manifest_record" 3 512)" == "$expected_manifest" ]] || refuse final-manifest
[[ "$(hash_path "$installer" "$installer_record" 4 131072)" == "$expected_installer" ]] || refuse final-installer
[[ "$(hash_path "$child/installer.manifest" "$copied_manifest_record" 6 512)" == "$expected_manifest" ]] || refuse final-copy-manifest
[[ "$(hash_path "$child/host_release_publish.py" "$copied_installer_record" 8 131072)" == "$expected_installer" ]] || refuse final-copy-installer
mapping "$script" "$script_record" 5
check_trees
deadline
builtin printf 'root-copy-observed-v1\n'
