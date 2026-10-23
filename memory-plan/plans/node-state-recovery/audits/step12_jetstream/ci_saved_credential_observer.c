#define _DARWIN_C_SOURCE 1
#define _POSIX_C_SOURCE 200809L
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/param.h>
#include <sys/types.h>
#include <stdint.h>
#include <stddef.h>
#include <limits.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

#if !defined(__APPLE__) || (!defined(__arm64__) && !defined(__aarch64__))
#error unsupported_platform
#endif
#if !defined(__BYTE_ORDER__) || !defined(__ORDER_LITTLE_ENDIAN__) || __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error unsupported_endian
#endif
_Static_assert(CHAR_BIT == 8, "char-bit");
_Static_assert(sizeof(void *) == 8, "pointer-width");
_Static_assert(sizeof(int) == 4, "int-width");
_Static_assert(sizeof(pid_t) == 4 && _Generic((pid_t)0, int: 1, default: 0), "pid-type");
_Static_assert(sizeof(uid_t) == 4 && _Generic((uid_t)0, uint32_t: 1, default: 0), "uid-type");
_Static_assert(sizeof(gid_t) == 4 && _Generic((gid_t)0, uint32_t: 1, default: 0), "gid-type");
_Static_assert(sizeof(uint64_t) == 8, "u64-width");
_Static_assert(sizeof(struct proc_bsdinfo) == 136, "bsdinfo-size");
_Static_assert(_Alignof(struct proc_bsdinfo) == 8, "bsdinfo-alignment");
_Static_assert(PROC_PIDTBSDINFO == 3, "flavor");
_Static_assert(MAXCOMLEN == 16, "maxcomlen");
_Static_assert(_Generic(&proc_pidinfo, int (*)(int,int,uint64_t,void *,int): 1, default: 0), "proc-pidinfo-signature");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_pid) == 12, "pbi_pid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_pid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_pid, uint32_t: 1, default: 0), "pbi_pid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_ppid) == 16, "pbi_ppid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_ppid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_ppid, uint32_t: 1, default: 0), "pbi_ppid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_uid) == 20, "pbi_uid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_uid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_uid, uint32_t: 1, default: 0), "pbi_uid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_gid) == 24, "pbi_gid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_gid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_gid, uint32_t: 1, default: 0), "pbi_gid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_ruid) == 28, "pbi_ruid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_ruid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_ruid, uint32_t: 1, default: 0), "pbi_ruid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_rgid) == 32, "pbi_rgid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_rgid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_rgid, uint32_t: 1, default: 0), "pbi_rgid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_svuid) == 36, "pbi_svuid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_svuid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_svuid, uint32_t: 1, default: 0), "pbi_svuid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_svgid) == 40, "pbi_svgid-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_svgid) == 4 && _Generic(((struct proc_bsdinfo *)0)->pbi_svgid, uint32_t: 1, default: 0), "pbi_svgid-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_start_tvsec) == 120, "pbi_start_tvsec-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_start_tvsec) == 8 && _Generic(((struct proc_bsdinfo *)0)->pbi_start_tvsec, uint64_t: 1, default: 0), "pbi_start_tvsec-type");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_start_tvusec) == 128, "pbi_start_tvusec-offset");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_start_tvusec) == 8 && _Generic(((struct proc_bsdinfo *)0)->pbi_start_tvusec, uint64_t: 1, default: 0), "pbi_start_tvusec-type");

static void emit_layout(void) {
    uint16_t endian = 1;
    printf("{\"alignment\":%zu,\"architecture\":\"arm64\",\"char_bit\":%d,\"endian\":\"%s\",\"fields\":{", _Alignof(struct proc_bsdinfo), CHAR_BIT, *((unsigned char *)&endian) == 1 ? "little" : "big");
    printf("\"pbi_gid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_gid), sizeof(((struct proc_bsdinfo *)0)->pbi_gid));
    printf(",\"pbi_pid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_pid), sizeof(((struct proc_bsdinfo *)0)->pbi_pid));
    printf(",\"pbi_ppid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_ppid), sizeof(((struct proc_bsdinfo *)0)->pbi_ppid));
    printf(",\"pbi_rgid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_rgid), sizeof(((struct proc_bsdinfo *)0)->pbi_rgid));
    printf(",\"pbi_ruid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_ruid), sizeof(((struct proc_bsdinfo *)0)->pbi_ruid));
    printf(",\"pbi_start_tvsec\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_start_tvsec), sizeof(((struct proc_bsdinfo *)0)->pbi_start_tvsec));
    printf(",\"pbi_start_tvusec\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_start_tvusec), sizeof(((struct proc_bsdinfo *)0)->pbi_start_tvusec));
    printf(",\"pbi_svgid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_svgid), sizeof(((struct proc_bsdinfo *)0)->pbi_svgid));
    printf(",\"pbi_svuid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_svuid), sizeof(((struct proc_bsdinfo *)0)->pbi_svuid));
    printf(",\"pbi_uid\":{\"offset\":%zu,\"width\":%zu}", offsetof(struct proc_bsdinfo, pbi_uid), sizeof(((struct proc_bsdinfo *)0)->pbi_uid));
    printf("},\"flavor\":%d,\"maxcomlen\":%d,\"signature\":\"int(int,int,uint64_t,void*,int)\",\"size\":%zu,\"types\":{", PROC_PIDTBSDINFO, MAXCOMLEN, sizeof(struct proc_bsdinfo));
    printf("\"gid\":{\"bytes\":%zu,\"signed\":%s},", sizeof(gid_t), _Generic((gid_t)0, uint32_t: 1, default: 0) ? "false" : "true");
    printf("\"int\":{\"bytes\":%zu,\"signed\":true},", sizeof(int));
    printf("\"pid\":{\"bytes\":%zu,\"signed\":%s},", sizeof(pid_t), _Generic((pid_t)0, int: 1, default: 0) ? "true" : "false");
    printf("\"pointer\":{\"bytes\":%zu,\"signed\":null},", sizeof(void *));
    printf("\"u64\":{\"bytes\":%zu,\"signed\":%s},", sizeof(uint64_t), _Generic((uint64_t)0, unsigned long: 1, unsigned long long: 1, default: 0) ? "false" : "true");
    printf("\"uid\":{\"bytes\":%zu,\"signed\":%s}}}", sizeof(uid_t), _Generic((uid_t)0, uint32_t: 1, default: 0) ? "false" : "true");
}

#include <errno.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
#include <signal.h>
#include <sys/resource.h>

struct getters { uint32_t uid, euid, gid, egid; };
struct sudo_value { const char *raw, *tag; size_t length; uint32_t number; int has_number; };

static int read_sudo(struct sudo_value *value) {
    memset(value, 0, sizeof(*value));
    value->raw = getenv("SUDO_UID");
    if (value->raw == NULL) { value->tag = "absent"; return 0; }
    value->length = strnlen(value->raw, 33);
    if (value->length > 32) { return -1; }
    value->tag = "noncanonical";
    if (value->length == 0 || value->length > 10 || (value->length > 1 && value->raw[0] == '0')) { return 0; }
    uint64_t number = 0;
    for (size_t i = 0; i < value->length; ++i) {
        unsigned char ch = (unsigned char)value->raw[i];
        if (ch < '0' || ch > '9') { return 0; }
        number = number * 10 + (uint64_t)(ch - '0');
        if (number > UINT32_MAX) { return 0; }
    }
    value->number = (uint32_t)number;
    value->has_number = 1;
    value->tag = value->number == UINT32_MAX ? "sentinel" : "canonical-decimal";
    return 0;
}

static int prepare_self_alarm(void) {
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = SIG_DFL;
    sigset_t mask;
    struct rlimit core = { .rlim_cur = 0, .rlim_max = 0 };
    if (sigemptyset(&action.sa_mask) != 0 || sigaction(SIGALRM, &action, NULL) != 0 ||
        sigemptyset(&mask) != 0 || sigaddset(&mask, SIGALRM) != 0 ||
        sigprocmask(SIG_UNBLOCK, &mask, NULL) != 0 || setrlimit(RLIMIT_CORE, &core) != 0) { return -1; }
    (void)alarm(4);
    return 0;
}

static struct getters sample_getters(void) {
    struct getters value = { (uint32_t)getuid(), (uint32_t)geteuid(), (uint32_t)getgid(), (uint32_t)getegid() };
    return value;
}

static int clock_ns(clockid_t clock, uint64_t *value) {
    struct timespec stamp;
    if (clock_gettime(clock, &stamp) != 0 || stamp.tv_sec < 0 || stamp.tv_nsec < 0 || stamp.tv_nsec >= 1000000000L ||
        (uint64_t)stamp.tv_sec > (UINT64_MAX - (uint64_t)stamp.tv_nsec) / UINT64_C(1000000000)) { return -1; }
    *value = (uint64_t)stamp.tv_sec * UINT64_C(1000000000) + (uint64_t)stamp.tv_nsec;
    return 0;
}

static void emit_getters(struct getters value) {
    printf("{\"egid\":%" PRIu32 ",\"euid\":%" PRIu32 ",\"gid\":%" PRIu32 ",\"uid\":%" PRIu32 "}", value.egid, value.euid, value.gid, value.uid);
}

static void emit_hex(const unsigned char *bytes, size_t length) {
    fputc('"', stdout);
    for (size_t i = 0; i < length; ++i) { printf("%02x", (unsigned int)bytes[i]); }
    fputc('"', stdout);
}

int main(int argc, char **argv) {
    if (argc != 4 || strcmp(argv[1], "--ci-saved-self") != 0 ||
        strcmp(argv[2], "00000000-0000-0000-0000-000000000003") != 0 ||
        (strcmp(argv[3], "plain") != 0 && strcmp(argv[3], "sudo") != 0)) {
        fputs("ci-saved-self: invalid arguments\n", stderr);
        return 64;
    }
    struct sudo_value sudo_uid;
    if (read_sudo(&sudo_uid) != 0 || prepare_self_alarm() != 0) {
        fputs("ci-saved-self: bounded startup failure\n", stderr);
        return 70;
    }
    uint64_t mono_before, wall_before, mono_after, wall_after;
    if (clock_ns(CLOCK_MONOTONIC, &mono_before) != 0 || clock_ns(CLOCK_REALTIME, &wall_before) != 0) {
        fputs("ci-saved-self: clock failure\n", stderr);
        return 70;
    }
    uint32_t pid_before = (uint32_t)getpid(), ppid_before = (uint32_t)getppid();
    struct getters before = sample_getters();
    struct proc_bsdinfo info;
    memset(&info, 0, sizeof(info));
    errno = 0;
    int rc = proc_pidinfo(getpid(), PROC_PIDTBSDINFO, 0, &info, (int)sizeof(info));
    int native_errno = errno;
    uint32_t pid_after = (uint32_t)getpid(), ppid_after = (uint32_t)getppid();
    struct getters after = sample_getters();
    if (clock_ns(CLOCK_MONOTONIC, &mono_after) != 0 || clock_ns(CLOCK_REALTIME, &wall_after) != 0) {
        fputs("ci-saved-self: clock failure\n", stderr);
        return 70;
    }
    int exact = rc == 136 && native_errno == 0;
    const char *status = rc <= 0 ? "api-failure" : rc != 136 ? "length-mismatch" : native_errno != 0 ? "errno-mismatch" : "exact-success";
    printf("{\"clocks\":{\"monotonic_ns_after\":%" PRIu64 ",\"monotonic_ns_before\":%" PRIu64 ",\"wallclock_ns_after\":%" PRIu64 ",\"wallclock_ns_before\":%" PRIu64 "},\"context\":\"%s\",\"getters_after\":", mono_after, mono_before, wall_after, wall_before, argv[3]);
    emit_getters(after);
    fputs(",\"getters_before\":", stdout);
    emit_getters(before);
    fputs(",\"layout\":", stdout);
    emit_layout();
    printf(",\"native\":{\"errno\":%d,\"fields\":", native_errno);
    if (!exact) { fputs("null", stdout); }
    else {
        fputc('{', stdout);
        printf("\"pbi_gid\":%" PRIu32, (uint32_t)info.pbi_gid);
        printf(",\"pbi_pid\":%" PRIu32, (uint32_t)info.pbi_pid);
        printf(",\"pbi_ppid\":%" PRIu32, (uint32_t)info.pbi_ppid);
        printf(",\"pbi_rgid\":%" PRIu32, (uint32_t)info.pbi_rgid);
        printf(",\"pbi_ruid\":%" PRIu32, (uint32_t)info.pbi_ruid);
        printf(",\"pbi_start_tvsec\":%" PRIu64, (uint64_t)info.pbi_start_tvsec);
        printf(",\"pbi_start_tvusec\":%" PRIu64, (uint64_t)info.pbi_start_tvusec);
        printf(",\"pbi_svgid\":%" PRIu32, (uint32_t)info.pbi_svgid);
        printf(",\"pbi_svuid\":%" PRIu32, (uint32_t)info.pbi_svuid);
        printf(",\"pbi_uid\":%" PRIu32, (uint32_t)info.pbi_uid);
        fputc('}', stdout);
    }
    fputs(",\"raw_hex\":", stdout);
    if (exact) { emit_hex((const unsigned char *)&info, sizeof(info)); } else { fputs("null", stdout); }
    printf(",\"rc\":%d,\"status\":\"%s\"},\"pid_after\":%" PRIu32 ",\"pid_before\":%" PRIu32 ",\"ppid_after\":%" PRIu32 ",\"ppid_before\":%" PRIu32 ",\"schema\":\"openclaw-ci-saved-self-v1\",\"sudo_uid\":{\"number\":", rc, status, pid_after, pid_before, ppid_after, ppid_before);
    if (sudo_uid.has_number) { printf("%" PRIu32, sudo_uid.number); } else { fputs("null", stdout); }
    fputs(",\"raw_hex\":", stdout);
    if (sudo_uid.raw == NULL) { fputs("null", stdout); } else { emit_hex((const unsigned char *)sudo_uid.raw, sudo_uid.length); }
    printf(",\"tag\":\"%s\"}}\n", sudo_uid.tag);
    if (fflush(stdout) != 0 || ferror(stdout)) { return 74; }
    return exact ? 0 : 1;
}
