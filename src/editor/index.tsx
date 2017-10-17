import { default as ConfigTab, JoinServer } from './ConfigTab/ConfigTab';
import './css/app.css';
import './css/codemirror.css';
import './GraphQLEditor/editor.css';
import 'graphiql/graphiql.css';

import * as classNames from 'classnames';
import * as GraphiQL from 'graphiql';
import { buildSchema, extendSchema, GraphQLSchema, parse } from 'graphql';
import * as fetch from 'isomorphic-fetch';
import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { directiveIDL } from '../directives';
import GraphQLEditor from './GraphQLEditor/GraphQLEditor';
import { ConsoleIcon, EditIcon, GithubIcon, LinkIcon, VoyagerIcon } from './icons';

type FakeEditorState = {
  value: string | null;
  cachedValue: string | null;
  activeTab: number;
  dirty: boolean;
  error: string | null;
  status: string | null;
  schema: GraphQLSchema | null;
  dirtySchema: GraphQLSchema | null;
  proxiedSchemaIDL: string | null;

  serversReady: boolean;
  servers: JoinServer[];
};

class FakeEditor extends React.Component<any, FakeEditorState> {
  constructor(props) {
    super(props);

    this.state = {
      value: null,
      cachedValue: null,
      activeTab: 0,
      dirty: false,
      dirtySchema: null,
      error: null,
      status: null,
      schema: null,
      proxiedSchemaIDL: null,

      serversReady: false,
      servers: [],
    };
  }

  componentDidMount() {
    this.updateValue({ schemaIDL: 'type Query { field: String }', extensionIDL: '' });
    // this.fetcher('/user-idl')
    //   .then(response => response.json())
    //   .then(IDLs => {
    //     this.updateValue(IDLs);
    //   });

    // window.onbeforeunload = () => {
    //   if (this.state.dirty) return 'You have unsaved changes. Exit?';
    // };
  }

  fetcher(url, options = {}) {
    const baseUrl = '..';
    return fetch(baseUrl + url, {
      credentials: 'include',
      ...options,
    });
  }

  graphQLFetcher(graphQLParams) {
    return this.fetcher('/graphql', {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphQLParams),
    }).then(response => response.json());
  }

  updateValue({ schemaIDL, extensionIDL }) {
    let value = extensionIDL || schemaIDL;
    const proxiedSchemaIDL = extensionIDL ? schemaIDL : null;

    this.setState({
      value,
      cachedValue: value,
      proxiedSchemaIDL,
    });
    this.updateIdl(value, true);
  }

  postIDL(idl): Promise<{ ok: boolean; text: () => Promise<string> }> {
    // let c = fetch('https://test')
    // return this.fetcher('/user-idl', {
    //   method: 'post',
    //   headers: { 'Content-Type': 'text/plain' },
    //   body: idl,
    // });
    return Promise.resolve({ ok: true, text: async () => '' });
  }

  buildSchema(value) {
    if (this.state.proxiedSchemaIDL) {
      let schema = buildSchema(this.state.proxiedSchemaIDL + '\n' + directiveIDL);
      return extendSchema(schema, parse(value));
    } else {
      return buildSchema(value + '\n' + directiveIDL);
    }
  }

  updateIdl(value, noError = false) {
    try {
      const schema = this.buildSchema(value);
      this.setState(prevState => ({
        ...prevState,
        schema,
        error: null,
      }));
      return true;
    } catch (e) {
      if (noError) return;
      this.setState(prevState => ({ ...prevState, error: e.message }));
      return false;
    }
  }

  setStatus(status, delay) {
    this.setState(prevState => ({ ...prevState, status: status }));
    if (!delay) return;
    setTimeout(() => {
      this.setState(prevState => ({ ...prevState, status: null }));
    }, delay);
  }

  saveUserIDL = () => {
    let { value, dirty } = this.state;
    if (!dirty) return;

    if (!this.updateIdl(value)) return;

    this.postIDL(value).then(res => {
      if (res.ok) {
        this.setStatus('Saved!', 2000);
        return this.setState(prevState => ({
          ...prevState,
          cachedValue: value,
          dirty: false,
          dirtySchema: null,
          error: null,
        }));
      } else {
        res.text().then(errorMessage => {
          return this.setState(prevState => ({
            ...prevState,
            error: errorMessage,
          }));
        });
      }
    });
  };

  switchTab(tab) {
    this.setState(prevState => ({ ...prevState, activeTab: tab }));
  }

  onEdit = val => {
    if (this.state.error) this.updateIdl(val);
    let dirtySchema = null as GraphQLSchema | null;
    try {
      dirtySchema = this.buildSchema(val);
    } catch (_) {}

    this.setState(prevState => ({
      ...prevState,
      value: val,
      dirty: val !== this.state.cachedValue,
      dirtySchema,
    }));
  };

  updateConfig = (ready: boolean, servers: JoinServer[]) => {
    this.setState({
      ...this.state,
      serversReady: ready,
      servers: servers,
    });
  };

  render() {
    let { value, activeTab, schema, dirty, dirtySchema, serversReady } = this.state;
    return (
      <div className="faker-editor-container">
        <nav>
          <div className="logo">
            <a href="https://github.com/APIs-guru/graphql-faker" target="_blank">
              {' '}
              <img src="./logo.svg" />{' '}
            </a>
          </div>
          <ul>
            {/* Servers config Tab icon*/}
            <li
              onClick={() => this.switchTab(0)}
              className={classNames({
                '-active': activeTab === 0,
              })}
            >
              {' '}
              <LinkIcon />{' '}
            </li>
            {/* IDL editor Tab icon*/}
            <li
              onClick={() => this.switchTab(1)}
              className={classNames({
                '-disabled': !serversReady,
                '-active': activeTab === 1,
                '-dirty': dirty,
              })}
            >
              {' '}
              <EditIcon />{' '}
            </li>
            {/* GraphiQL editor Tab icon*/}
            <li
              onClick={() => this.state.schema && this.switchTab(2)}
              className={classNames({
                '-disabled': !this.state.schema || !serversReady,
                '-active': activeTab === 2,
              })}
            >
              {' '}
              <ConsoleIcon />{' '}
            </li>
            {/* Voyager editor Tab icon*/}
            <li
              onClick={() => this.state.schema && this.switchTab(3)}
              className={classNames({
                '-disabled': !this.state.schema || !serversReady,
                '-active': activeTab === 3,
              })}
            >
              {' '}
              <VoyagerIcon />{' '}
            </li>
            <li className="-pulldown -link">
              <a href="https://github.com/APIs-guru/graphql-faker" target="_blank">
                {' '}
                <GithubIcon />{' '}
              </a>
            </li>
          </ul>
        </nav>
        <div className="tabs-container">
          <div
            className={classNames('tab-content', 'config-container', {
              '-active': activeTab === 0,
            })}
          >
            <ConfigTab fetcher={this.fetcher} onChange={this.updateConfig} />
          </div>
          <div
            className={classNames('tab-content', 'editor-container', {
              '-active': activeTab === 1,
            })}
          >
            <GraphQLEditor
              schema={dirtySchema || schema}
              onEdit={this.onEdit}
              onCommand={this.saveUserIDL}
              value={value || ''}
            />
            <div className="action-panel">
              <a
                className={classNames('material-button', {
                  '-disabled': !dirty,
                })}
                onClick={this.saveUserIDL}
              >
                <span> Save </span>
              </a>
              <div className="status-bar">
                <span className="status"> {this.state.status} </span>
                <span className="error-message">{this.state.error}</span>
              </div>
            </div>
          </div>
          <div
            className={classNames('tab-content', {
              '-active': activeTab === 2,
            })}
          >
            {this.state.schema && (
              <GraphiQL fetcher={e => this.graphQLFetcher(e)} schema={this.state.schema} />
            )}
          </div>
          <div
            className={classNames('tab-content', 'voyager-container', {
              '-active': activeTab === 3,
            })}
          >
            bye
          </div>
        </div>
      </div>
    );
  }
}

ReactDOM.render(<FakeEditor />, document.getElementById('container'));
