// import { mnemonicToPrivateKey } from 'ton-crypto';
import { WalletContractV3R2, TonClient, beginCell, toNano, Address } from '@ton/ton';
import { keyPairFromSeed, sign } from '@ton/crypto';
import dotenv from 'dotenv';
dotenv.config();

async function activateWallet() {
    const client = new TonClient({
        endpoint: 'http://109.236.91.95:8081/jsonRPC',
        apiKey: '',
    });
    const workchain = -1;

    const secretKey = Buffer.from(process.env.WALLET_PRIVATE_KEY || '', 'hex');

    const wallet = WalletContractV3R2.create({
        publicKey: Buffer.from(process.env.WALLET_PUBLIC_KEY || '', 'hex'),
        workchain: workchain,
        walletId: Number(process.env.WALLET_ID) || 1,
    });

    const accountInfo = await client.getContractState(wallet.address);
    console.log('Account state:', accountInfo.state);
    console.log('Account balance:', accountInfo.balance.toString(), 'nanoTON');
    const walletContract = client.open(wallet);
    const seqno = await walletContract.getSeqno();
    console.log('Current seqno:', seqno);

    if (accountInfo.state === 'uninitialized') {
        console.log('Initializing wallet...');

        const stateInit = wallet.init;
        const stateInitCell = beginCell()
            .storeBit(0) // No split_depth
            .storeBit(0) // No special
            .storeBit(1) // We have code
            .storeRef(stateInit.code)
            .storeBit(1) // We have data
            .storeRef(stateInit.data)
            .storeBit(0) // No library
            .endCell();

        const internalMessageBody = beginCell().storeUint(0, 32).storeStringTail('Hello, TON!').endCell();

        const internalMessage = beginCell()
            .storeUint(0x10, 6) // no bounce
            .storeAddress(wallet.address)
            .storeCoins(toNano('0.05'))
            .storeUint(1, 1 + 4 + 4 + 64 + 32 + 1 + 1) // We store 1 that means we have body as a reference
            .storeRef(internalMessageBody)
            .endCell();

        // message for our wallet
        const toSign = beginCell()
            .storeUint(wallet.walletId, 32)
            .storeUint(Math.floor(Date.now() / 1e3) + 60, 32)
            .storeUint(seqno, 32) // We put seqno = 0, because after deploying wallet will store 0 as seqno
            .storeUint(3, 8)
            .storeRef(internalMessage);

        const keyPair = keyPairFromSeed(secretKey);
        console.log('Keys Match:', keyPair.publicKey.toString('hex') === wallet.publicKey.toString('hex'));

        const signature = sign(toSign.endCell().hash(), keyPair.secretKey);
        const body = beginCell().storeBuffer(signature).storeBuilder(toSign).endCell();

        const externalMessage = beginCell()
            .storeUint(0b10, 2) // indicate that it is an incoming external message
            .storeUint(0, 2) // src -> addr_none
            .storeAddress(wallet.address)
            .storeCoins(0) // Import fee
            .storeBit(1) // We have State Init
            .storeBit(1) // We store State Init as a reference
            .storeRef(stateInitCell) // Store State Init as a reference
            .storeBit(1) // We store Message Body as a reference
            .storeRef(body) // Store Message Body as a reference
            .endCell();

        await client.sendFile(externalMessage.toBoc());

        console.log('Wallet deployed at:', wallet.address.toString());
    } else {
        console.log('Wallet already deployed at:', wallet.address.toString());
    }
}

activateWallet().catch(console.error);
