export abstract class Op {
    static new_key_block = 0x11a78ffe;
    static check_block = 0x8eaa9d76;
    static ok = 0xff8ff4e1;
    static correct = 0xce02b807;
    static check_transaction = 0x91d555f7;
    static transaction_checked = 0x756adff1;
}

export abstract class Error {
    static unknown_opcode = 0xffff;
}
