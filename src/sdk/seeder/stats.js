import {TorrentWebSeeder} from  '../../../proto/torrent-web-seeder/torrent-web-seeder_pb_service';
import {StatRequest, StatReply} from '../../../proto/torrent-web-seeder/torrent-web-seeder_pb';
import {grpc} from '@improbable-eng/grpc-web';
import process from '../process';
const debug = require('debug')('webtor:sdk:seeder:stats');
import _ from 'lodash';

class Stats {
    closed = false;
    client = null;
    constructor(url, path) {
        this.url = url;
        this.path = path;
    }
    close() {
        if (this.closed) return;
        this.closed = true;
        debug('close stats url=%o path=%o', this.url, this.path);
        if (this.client) this.client.close();
    }
    async start(onMessage, metadata, params) {

        while(!this.closed) {
            try {
                return await this._start(onMessage, metadata, params);
            } catch (e) {
                debug('failed to get stats error=%o', e)
                await (new Promise(resolve => setTimeout(resolve, params.statsRetryInterval)));
            }
        }
    }
    _start(onMessage, metadata, params) {
        const request = new StatRequest();
        request.setPath(this.path);
        this.client = grpc.client(TorrentWebSeeder.StatStream, {
            host: this.url,
            transport: grpc.WebsocketTransport(),
            debug: params.grpcDebug,
        });
        const statuses = _.invert(StatReply.Status);
        let map = null;
        const onMessageWrapper = (message) => {
            message.statusName = statuses[message.status];
            if (!map && message.status != 0) {
                map = message.piecesList;
            } else {
                for (const p of message.piecesList) {
                    for (const m of map) {
                        if (m.position == p.position) m.complete = p.complete;
                    }
                }
                message.piecesList = JSON.parse(JSON.stringify(map));
            }
            onMessage(this.path, message);
        }
        const onEnd = (res, resolve, reject) => {
            if (res !== grpc.Code.OK) {
                reject('failed to get stats torrent code=' + res);
            } else {
                debug('stats finished url=%o path=%o', this.url, this.path);
                this.close();
                resolve();
            }
        }

        return process(this.client, request, onMessageWrapper, onEnd, metadata, params);
    }
}

export default function(url, path, onMessage, metadata = {}, params = {}) {
    const stats = new Stats(url, path);
    stats.start(onMessage, metadata, params);
    return stats;
}