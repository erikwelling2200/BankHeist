import type { LevelProp } from '../../level/plan';
import type { Facing, Size } from '../../level/space';
import { atmScreen, camera, clock, crest, exitSign, keycardLed, noticeBoard, painting } from './dressing';
import { backCounter, bin, brochureRack, coffeeTable, counter, filingCabinet, mat, plant, printer, queueRail, sofa, waterCooler, writingDesk } from './furniture';
import { bench, cafeCounter, cafeTable, dumpster, generator, menuBoard, rifleCase, tree, wallLadder } from './outside';
import { alarmPanel, atmBack, bookshelf, boxes, breakerPanel, cashCart, cashShelf, cctvDesk, chair, depositBoxes, desk, diningTable, fridge, kitchenCounter, lockers, mopBucket, officeChair, serverRack, shelving, toilet, vaultConsole, washbasin } from './rooms';
import { bollard, hydrant, manhole, newsBox, streetBin, streetLamp } from './street';
import { vanArt } from './van';
import type { PropArt } from './view';

export type { PropArt } from './view';

/** Draws a prop of catalog size `s` (in its own frame) turned to `facing`; each kind is drawn by hand for every facing. */
export function propArt(p: LevelProp, s: Size, facing: Facing): PropArt {
    switch (p.kind) {
        case 'counter': return counter(p, s, facing);
        case 'backCounter': return backCounter(p, s, facing);
        case 'filingCabinet': return filingCabinet(s, facing);
        case 'printer': return printer(s, facing);
        case 'waterCooler': return waterCooler(s, facing);
        case 'crest': return crest(s, facing);
        case 'clock': return clock(s, facing);
        case 'painting': return painting(s, facing);
        case 'noticeBoard': return noticeBoard(s, facing);
        case 'exitSign': return exitSign(s, facing);
        case 'keycardLed': return keycardLed(s, facing);
        case 'atmScreen': return atmScreen(s, facing);
        case 'camera': return camera(s, facing);
        case 'queueRail': return queueRail(p, s, facing);
        case 'mat': return mat(s, facing);
        case 'writingDesk': return writingDesk(s, facing);
        case 'sofa': return sofa(s, facing);
        case 'coffeeTable': return coffeeTable(s, facing);
        case 'plant': return plant(s, facing, p.tx * 13 + p.ty * 7);
        case 'brochureRack': return brochureRack(s, facing);
        case 'bin': return bin(s, facing);
        case 'streetLamp': return streetLamp(s, facing);
        case 'hydrant': return hydrant(s, facing);
        case 'newsBox': return newsBox(s, facing);
        case 'streetBin': return streetBin(s, facing);
        case 'bollard': return bollard(s, facing);
        case 'manhole': return manhole(s, facing);
        case 'van': return vanArt(s, facing);
        case 'depositBoxes': return depositBoxes(s, facing);
        case 'cashShelf': return cashShelf(s, facing);
        case 'vaultConsole': return vaultConsole(s, facing);
        case 'serverRack': return serverRack(s, facing);
        case 'cashCart': return cashCart(s, facing);
        case 'alarmPanel': return alarmPanel(s, facing);
        case 'breakerPanel': return breakerPanel(s, facing);
        case 'cctvDesk': return cctvDesk(s, facing);
        case 'desk': return desk(s, facing);
        case 'officeChair': return officeChair(s, facing);
        case 'bookshelf': return bookshelf(s, facing);
        case 'lockers': return lockers(s, facing);
        case 'shelving': return shelving(s, facing);
        case 'mopBucket': return mopBucket(s, facing);
        case 'atmBack': return atmBack(s, facing);
        case 'boxes': return boxes(s, facing);
        case 'diningTable': return diningTable(s, facing);
        case 'chair': return chair(s, facing);
        case 'fridge': return fridge(s, facing);
        case 'kitchenCounter': return kitchenCounter(s, facing);
        case 'toilet': return toilet(s, facing);
        case 'washbasin': return washbasin(s, facing);
        case 'cafeTable': return cafeTable(s, facing);
        case 'cafeCounter': return cafeCounter(s, facing);
        case 'menuBoard': return menuBoard(s, facing);
        case 'dumpster': return dumpster(s, facing);
        case 'generator': return generator(s, facing);
        case 'wallLadder': return wallLadder(s, facing);
        case 'tree': return tree(s, facing);
        case 'bench': return bench(s, facing);
        case 'rifleCase': return rifleCase(s, facing);
    }
}
