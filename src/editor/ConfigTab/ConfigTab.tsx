import * as React from 'react';
import * as Panel from 'react-bootstrap/lib/Panel';
import { GraphQLSchema } from 'graphql';

import './style.css';
import { buildClientSchema } from 'graphql';

export type JoinServer = {
  name: string;
  url: string;
  headers: {
    name: string;
    value: string;
  }[];
  forwardHeaders: string[];
  rateLimit?: number;
  prefix?: string;
  schema?: GraphQLSchema;
};

export interface ConfigTabProps {
  fetcher: (url: string, options) => Promise<Response>;
  onChange: (ready: boolean, config?: JoinServer[]) => void;
}

export interface ConfigTabState {
  servers: (JoinServer & {
    isSchemaLoading?: boolean;
    error?: string;
  })[];
  activePresetName: string;
}

const presets = [
  {
    name: 'Yelp + GraphQL world',
    servers: [
      {
        name: 'Yelp',
        url: 'https://yelp.com',
        headers: [],
        forwardHeaders: [],
        rateLimit: 100,
        prefix: 'Yelp',
      },
      {
        name: 'GraphQL worlds',
        url: 'https://graphql-world.com',
        headers: [],
        forwardHeaders: [],
      },
    ],
  },
  {
    name: 'Yelp + Test',
    servers: [
      {
        name: 'Yelp',
        url: 'https://yelp.com',
        headers: [],
        forwardHeaders: [],
        prefix: 'Yelp',
      },
      {
        name: 'Test',
        url: 'https://text.com',
        headers: [],
        forwardHeaders: [],
      },
    ],
  },
  {
    name: 'DOM + Github',
    servers: [
      {
        name: 'DOM',
        url: 'https://dom.com',
        headers: [],
        forwardHeaders: [],
      },
      {
        name: 'Github',
        url: 'https://api.github.com',
        headers: [
          {
            name: 'Authorization',
            value: 'Bearer 1234',
          },
        ],
        forwardHeaders: ['X-Rate-Limiting'],
      },
    ],
  },
  {
    servers: [],
    name: 'Custom',
  },
];

function replaceNthItem<T>(arr: T[], idx: number, item: T): T[] {
  const res = arr.slice();
  res[idx] = item;
  return res;
}

export default class ConfigTab extends React.PureComponent<ConfigTabProps, ConfigTabState> {
  constructor(props) {
    super(props);

    this.state = {
      servers: [],
      activePresetName: 'Custom',
    };
  }

  setPreset = preset => {
    this.setState({ servers: preset.servers, activePresetName: preset.name });
  };

  handleChange = (serverIdx, fieldName) => {
    return event => {
      const servers = this.state.servers;
      const updatedServer = { ...servers[serverIdx], [fieldName]: event.target.value };
      this.setState({
        servers: replaceNthItem(servers, serverIdx, updatedServer),
      });
    };
  };

  updHeader = (serverIdx: number, headerIdx: number, fieldName: string) => {
    return event => {
      const servers = this.state.servers;
      const headers = this.state.servers[serverIdx].headers;
      const updHeader = { ...headers[headerIdx], [fieldName]: event.target.value };
      const updHeaders = replaceNthItem(headers, headerIdx, updHeader);
      const updatedServer = { ...servers[serverIdx], headers: updHeaders };
      this.setState({
        servers: replaceNthItem(servers, serverIdx, updatedServer),
      } as any);
    };
  };

  addHeader(serverIdx: number) {
    const servers = this.state.servers;
    const headers = this.state.servers[serverIdx].headers;
    const updatedServer = {
      ...servers[serverIdx],
      headers: [...headers, { value: '', name: '' }],
    };
    this.setState({
      servers: replaceNthItem(servers, serverIdx, updatedServer),
    });
  }

  checkConfigIsValid() {
    // check if all servers have schema and run onChange prop to notify parent component
    // TODO: implement
    if (true && Math.random()) {
      this.props.onChange(true, this.state.servers);
    } else {
      this.props.onChange(false);
    }
  }

  async updateServerSchema(serverIdx: number) {
    const server = this.state.servers[serverIdx];

    // todo: fetch and update schema
    this.setState({
      servers: replaceNthItem(this.state.servers, serverIdx, { ...server, isSchemaLoading: true }),
    });
    const res = await this.props.fetcher(server.url, { headers: server.headers });
    if (res.ok) {
      const introspection = await res.json();
      this.setState({
        servers: replaceNthItem(this.state.servers, serverIdx, {
          ...server,
          isSchemaLoading: false,
          schema: buildClientSchema(introspection),
        }),
      });
    } else {
      this.setState({
        servers: replaceNthItem(this.state.servers, serverIdx, {
          ...server,
          isSchemaLoading: false,
          error: await res.text(),
        }),
      });
    }
  }

  render() {
    const { servers, activePresetName } = this.state;

    return (
      <div>
        <div className="presets">
          {presets.map(preset => (
            <div
              key={preset.name}
              className={'card' + (preset.name === activePresetName ? ' -active' : '')}
              onClick={() => this.setPreset(preset)}
            >
              {preset.name}
            </div>
          ))}
        </div>
        <h2> Remote schemas to join </h2>
        {servers.map((server, idx) => (
          <div key={idx} className="panel panel-default">
            <div className="panel-body">
              <table className="fields">
                <tbody>
                  <tr>
                    <td>
                      <label>Name:</label>
                    </td>
                    <td>
                      <input
                        className="form-control"
                        onChange={this.handleChange(idx, 'name')}
                        value={server.name}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <label>Server URL:</label>
                    </td>
                    <td>
                      <input
                        className="form-control"
                        value={server.url}
                        onChange={this.handleChange(idx, 'url')}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <label>Headers</label>
                    </td>
                    <td>
                      <div className="headers">
                        {server.headers.map((header, headerIdx) => (
                          <div className="header" key={headerIdx}>
                            <input
                              className="form-control"
                              placeholder="Header"
                              value={header.name}
                              onChange={this.updHeader(idx, headerIdx, 'name')}
                            />
                            <input
                              className="form-control"
                              placeholder="Header"
                              value={header.value}
                              onChange={this.updHeader(idx, headerIdx, 'value')}
                            />
                          </div>
                        ))}
                      </div>
                      <button className="btn btn-primary" onClick={this.addHeader.bind(idx)}>
                        Add
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="panel-footer">
              <button className="btn btn-success" onClick={this.updateServerSchema.bind(idx)}>
                {server.isSchemaLoading
                  ? 'Loading'
                  : server.schema ? 'Update introspection' : 'Get introspection'}
              </button>
              {server.error && <span className="text-error"> {server.error}</span>}
            </div>
          </div>
        ))}
      </div>
    );
  }
}
