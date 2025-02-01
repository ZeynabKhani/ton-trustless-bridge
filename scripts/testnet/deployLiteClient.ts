import { toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import { compile, NetworkProvider } from '@ton/blueprint';
import fs from 'fs';

export async function run(provider: NetworkProvider) {
    const liteClientCode = await compile('FastnetLiteClient');
    const workchain = 0;

    const initialDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/keyblock1.json'), 'utf8');
    let initialData = JSON.parse(initialDataRaw);

    let initialBlock = {
        kind: initialData.block.kind,
        id: initialData.block.id,
        data: initialData.block.data,
    };

    const { curValidatorSet, prevValidatorSet, nextValidatorSet, utime_since, utime_until } =
        LiteClient.getInitialDataConfig(initialBlock, workchain);

    let liteClient = provider.open(
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

    // await liteClient.sendDeploy(provider.sender(), toNano('0.05'));

    // await provider.waitForDeploy(liteClient.address);

    let testDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/keyblock2.json'), 'utf8');
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
    // await liteClient.sendNewKeyBlock(provider.sender(), blockHeader, block, signatures, workchain, toNano('0.05'));

    testDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/keyblock3.json'), 'utf8');
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

    // await liteClient.sendCheckBlock(provider.sender(), blockHeader, block, signatures, toNano('0.05'));
    // await liteClient.sendNewKeyBlock(provider.sender(), blockHeader, block, signatures, workchain, toNano('0.05'));

    testDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/keyblock4.json'), 'utf8');
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

    // await liteClient.sendNewKeyBlock(provider.sender(), blockHeader, block, signatures, workchain, toNano('0.05'));
    // https://testnet.tonviewer.com/kQCQhihl9a4EVhWU7gZNU5_QxaZ1sBwKw9R_40_evxjfzx3T
}
