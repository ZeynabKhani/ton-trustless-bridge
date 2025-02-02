import { address, Address, beginCell, Cell, loadTransaction, OpenedContract, toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import { compile } from '@ton/blueprint';
import fs from 'fs';
import { TonClient, WalletContractV3R2 } from '@ton/ton';
import { keyPairFromSeed, sign } from '@ton/crypto';
import dotenv from 'dotenv';
dotenv.config();

async function sendMessage(
    client: TonClient,
    wallet: WalletContractV3R2,
    liteClient: OpenedContract<LiteClient>,
    messageValue: bigint,
    internalMessageBody: Cell,
    seqno: number,
    secretKey: Buffer,
) {
    const internalMessage = beginCell()
        .storeUint(0x10, 6) // no bounce
        .storeAddress(liteClient.address)
        .storeCoins(messageValue)
        .storeUint(0, 1 + 4 + 4 + 64 + 32)
        .storeBit(0) // we have no State Init
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

    console.log('New key block sent to LiteClient at: ', liteClient.address.toString());
}

export async function sendNewKeyBlock() {
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
        console.log('Sending new key block to LiteClient at address:', liteClient.address.toString());

        const liteClientInfo = await client.getContractState(liteClient.address);
        console.log('LiteClient state:', liteClientInfo.state);
        console.log('LiteClient balance:', liteClientInfo.balance.toString(), 'nanoTON');

        if (liteClientInfo.state === 'uninitialized') {
            console.log('LiteClient is not initialized');
            return;
        }

        if (!liteClient.init) {
            console.log('LiteClient init is not found');
            return;
        }

        const messageValue = toNano('1.5'); // masterchain fees are higher

        let testDataRaw = fs.readFileSync(require.resolve('../../tests/testnet/keyblock2.json'), 'utf8');
        let blockData = JSON.parse(testDataRaw);

        let blockHeader = {
            kind: blockData.header.kind,
            id: blockData.header.id,
            mode: blockData.header.mode,
            headerProof: blockData.header.headerProof,
        };
        let block = {
            kind: blockData.block.kind,
            id: blockData.block.id,
            data: blockData.block.data,
        };
        let signatures = blockData.signatures;
        const internalMessageBody = LiteClient.newKeyBlockMessage(blockHeader, block, signatures, workchain);
        // await sendMessage(client, wallet, liteClient, messageValue, internalMessageBody, seqno, secretKey);

        testDataRaw = fs.readFileSync(require.resolve('../../tests/testnet/keyblock3.json'), 'utf8');
        blockData = JSON.parse(testDataRaw);

        blockHeader = {
            kind: blockData.header.kind,
            id: blockData.header.id,
            mode: blockData.header.mode,
            headerProof: blockData.header.headerProof,
        };
        block = {
            kind: blockData.block.kind,
            id: blockData.block.id,
            data: blockData.block.data,
        };
        signatures = blockData.signatures;
        const internalMessage2Body = LiteClient.checkBlockMessage(blockHeader, block, signatures);
        await sendMessage(client, wallet, liteClient, messageValue, internalMessage2Body, seqno, secretKey);

        const internalMessage3Body = LiteClient.newKeyBlockMessage(blockHeader, block, signatures, workchain);
        // await sendMessage(client, wallet, liteClient, messageValue, internalMessage3Body, seqno, secretKey);
    } else {
        console.log('Wallet is not active');
    }
}
// sendNewKeyBlock().catch(console.error);

async function getLastTransaction() {
    const client = new TonClient({
        endpoint: 'http://109.236.91.95:8081/jsonRPC',
        apiKey: '',
    });

    const walletAddress = Address.parse('Ef9q0rgzDmp8B4CwAcAgaLrjjbLra_dTvNTNysfc6bRxXUqF');
    const liteClientAddress = Address.parse('Ef-i33FwtLRzM7dBIXQ0stduWqdE-_PhDxN-Vksuq0v93RJw');

    const address = liteClientAddress;
    const txs = await client.getTransactions(address, {
        limit: 7,
    });

    const tx = txs[1];

    if (tx.description.type === 'generic') {
        console.log(tx.description);
        console.log(tx.inMessage?.info);
        console.log(tx.outMessages.get(0)?.body.beginParse().loadUint(32).toString());
        console.log(tx.totalFees);
        console.log((await client.getContractState(address)).balance.toString());
    }
}
// getLastTransaction().catch(console.error);
