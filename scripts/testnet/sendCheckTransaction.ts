import { Address, toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import { compile, NetworkProvider } from '@ton/blueprint';
import fs from 'fs';
import { TransactionChecker } from '../../wrappers/TransactionChecker';

export async function run(provider: NetworkProvider) {
    const transactionCheckerCode = await compile('TransactionChecker');
    const workchain = 0;
    const blocksWorkchain = -1;

    const liteClient = LiteClient.createFromAddress(Address.parse('kQCPAjpID4kOV-_CuCa929zDjUpRbHdJJtW-KqOG2hwVroTC'));

    const transactionChecker = provider.open(
        TransactionChecker.createFromConfig(
            {
                lite_client: liteClient.address,
                queries_cnt: 0n,
            },
            transactionCheckerCode,
            workchain,
        ),
    );

    const blockDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/keyblock1.json'), 'utf8');
    const blockData = JSON.parse(blockDataRaw);

    const blockHeader = {
        kind: blockData.header.kind,
        id: blockData.header.id,
        mode: blockData.header.mode,
        headerProof: blockData.header.headerProof,
    };
    const block = {
        kind: blockData.block.kind,
        id: blockData.block.id,
        data: blockData.block.data,
    };
    const signatures = blockData.signatures;

    const txDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/txDataFromKeyBlock1.json'), 'utf8');
    const txData = JSON.parse(txDataRaw);
    const txWithProof = {
        kind: txData.kind,
        id: txData.id,
        proof: txData.proof,
        transaction: txData.transaction,
    };

    await transactionChecker.sendCheckTransaction(
        provider.sender(),
        txWithProof,
        blockHeader,
        block,
        signatures,
        toNano('0.05'),
    );
}
