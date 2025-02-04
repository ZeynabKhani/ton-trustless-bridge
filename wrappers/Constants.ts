export abstract class Op {
    static new_key_block = 0x11a78ffe;
    static check_block = 0x8eaa9d76;
    static ok = 0xff8ff4e1;
    static correct = 0xce02b807;
    static reject = 0x7f3b8c1d;
    static check_transaction = 0x91d555f7;
    static transaction_checked = 0x756adff1;
}

export abstract class Error {
    static unknown_opcode = 0xffff;
    static inconsistent_proof = 0xfff1;
    static unauthorized = 0xfff2;
    static transaction_not_in_block = 0xfff4;
    static not_exotic = 0xf001;
}
