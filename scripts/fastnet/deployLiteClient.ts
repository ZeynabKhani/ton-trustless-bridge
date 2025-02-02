import { beginCell, toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import { compile } from '@ton/blueprint';
import fs from 'fs';
import { TonClient, WalletContractV3R2 } from '@ton/ton';
import { keyPairFromSeed, sign } from '@ton/crypto';
import dotenv from 'dotenv';
dotenv.config();

export async function deployLiteClient() {
    const client = new TonClient({
        endpoint: 'http://109.236.91.95:8081/jsonRPC',
        apiKey: '',
    });

    const liteClientCode = await compile('TestnetLiteClient');
    const workchain = -1;

    const initialDataRaw = fs.readFileSync(require.resolve('../../tests/testnet/keyblock1.json'), 'utf8');
    let initialData = JSON.parse(initialDataRaw);

    let initialBlock = {
        kind: initialData.block.kind,
        id: initialData.block.id,
        data: initialData.block.data,
    };

    const { curValidatorSet, prevValidatorSet, nextValidatorSet, utime_since, utime_until } =
        LiteClient.getInitialDataConfig(initialBlock, workchain);

    let liteClient = client.open(
        LiteClient.createFromConfig(
            {
                prev_validator_set: prevValidatorSet,
                cur_validator_set: curValidatorSet,
                next_validator_set: nextValidatorSet,
                utime_since,
                utime_until,
            },
            liteClientCode,
            workchain,
        ),
    );

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

    if (accountInfo.state === 'active') {
        console.log('Using wallet at address: ', wallet.address.toString());
        console.log('Deploying LiteClient at', liteClient.address.toString());

        const liteClientInfo = await client.getContractState(liteClient.address);
        console.log('LiteClient state:', liteClientInfo.state);
        console.log('LiteClient balance:', liteClientInfo.balance.toString(), 'nanoTON');

        if (liteClientInfo.state === 'active') {
            console.log('LiteClient already deployed');
            return;
        }

        if (!liteClient.init) {
            console.log('LiteClient init is not found');
            return;
        }

        const liteClientStateInitCell = beginCell()
            .storeBit(0) // No split_depth
            .storeBit(0) // No special
            .storeBit(1) // We have code
            .storeRef(liteClient.init.code)
            .storeBit(1) // We have data
            .storeRef(liteClient.init.data)
            .storeBit(0) // No library
            .endCell();

        const internalMessageBody = beginCell().endCell();

        const internalMessage = beginCell()
            .storeUint(0x10, 6) // no bounce
            .storeAddress(liteClient.address)
            .storeCoins(toNano('0.01'))
            .storeUint(0, 1 + 4 + 4 + 64 + 32)
            .storeBit(1) // we have State Init
            .storeBit(1) // we save State Init as a reference
            .storeRef(liteClientStateInitCell)
            .storeBit(1) // we have body
            .storeRef(internalMessageBody)
            .endCell();

        // message for our wallet
        const toSign = beginCell()
            .storeUint(wallet.walletId, 32)
            .storeUint(Math.floor(Date.now() / 1e3) + 60, 32)
            .storeUint(seqno, 32)
            .storeUint(3, 8) // mode
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
            .storeBit(0) // no State Init
            .storeBit(1) // We store Message Body as a reference
            .storeRef(body) // Store Message Body as a reference
            .endCell();

        await client.sendFile(externalMessage.toBoc());

        console.log('LiteClient deployed at:', liteClient.address.toString());
    } else {
        console.log('Wallet is not active');
    }
}
deployLiteClient().catch(console.error);
