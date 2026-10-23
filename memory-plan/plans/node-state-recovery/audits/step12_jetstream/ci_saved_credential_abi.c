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

int main(int argc, char **argv) {
    (void)argv;
    if (argc != 1) {
        fputs("ci-saved-abi: invalid arguments\n", stderr);
        return 64;
    }
    fputs("{\"layout\":", stdout);
    emit_layout();
    fputs(",\"schema\":\"openclaw-ci-saved-abi-v1\"}\n", stdout);
    return fflush(stdout) == 0 && !ferror(stdout) ? 0 : 74;
}
