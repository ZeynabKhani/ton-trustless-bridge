import { toNano } from '@ton/core';
import { LiteClient } from '../../wrappers/LiteClient';
import { compile, NetworkProvider } from '@ton/blueprint';
import fs from 'fs';

export async function run(provider: NetworkProvider) {
    const liteClientCode = await compile('LiteClient');
    const workchain = 0;
    const blocksWorkchain = -1;

    const initialDataRaw = fs.readFileSync(require.resolve('../../tests/fastnet/keyblock1.json'), 'utf8');
    let initialData = JSON.parse(initialDataRaw);

    let initialBlock = {
        kind: initialData.header.kind,
        id: initialData.header.id,
        data: initialData.block.data,
    };

    const { curValidatorSet, prevValidatorSet, nextValidatorSet, utime_since, utime_until } =
        LiteClient.getInitialDataConfig(initialBlock, blocksWorkchain);

    let liteClient = provider.open(
        LiteClient.createFromConfig(
            {
                prev_validator_set: prevValidatorSet,
                cur_validator_set: curValidatorSet,
                next_validator_set: nextValidatorSet,
                utime_since,
                utime_until,
                seqno: initialBlock.id.seqno,
                blocks_workchain: blocksWorkchain,
            },
            liteClientCode,
            workchain,
        ),
    );

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
    await liteClient.sendNewKeyBlock(
        provider.sender(),
        blockHeader,
        block,
        signatures,
        blocksWorkchain,
        toNano('0.05'),
    );
}
