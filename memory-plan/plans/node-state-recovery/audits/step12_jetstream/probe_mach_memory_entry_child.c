#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    size_t page = (size_t)getpagesize();
    int fd = open(argv[1], O_RDWR);
    if (fd < 0) return 3;
    void *mapped = mmap(NULL, page, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (mapped == MAP_FAILED) return 4;
    memory_object_size_t size = page;
    mach_port_t entry = MACH_PORT_NULL;
    kern_return_t result = mach_make_memory_entry_64(mach_task_self(), &size,
        (memory_object_offset_t)(uintptr_t)mapped, VM_PROT_READ | VM_PROT_WRITE,
        &entry, MACH_PORT_NULL);
    if (result != KERN_SUCCESS) {
        fprintf(stderr, "make_memory_entry:%d\n", result);
        return 5;
    }
    if (munmap(mapped, page) != 0 || close(fd) != 0) return 6;
    puts("ready");
    fflush(stdout);
    if (getchar() != 'x') return 7;
    mach_vm_address_t resumed = 0;
    result = mach_vm_map(mach_task_self(), &resumed, size, 0, VM_FLAGS_ANYWHERE,
                         entry, 0, 0, VM_PROT_READ | VM_PROT_WRITE,
                         VM_PROT_READ | VM_PROT_WRITE, VM_INHERIT_NONE);
    if (result != KERN_SUCCESS) {
        fprintf(stderr, "map_memory_entry:%d\n", result);
        return 8;
    }
    ((volatile char *)(uintptr_t)resumed)[0] = 'M';
    if (msync((void *)(uintptr_t)resumed, page, MS_SYNC) != 0) return 9;
    puts("wrote");
    fflush(stdout);
    mach_vm_deallocate(mach_task_self(), resumed, size);
    mach_port_deallocate(mach_task_self(), entry);
    return 0;
}
