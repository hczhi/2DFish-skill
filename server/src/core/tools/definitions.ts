import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作区中的文件内容。用于获取用户的知识文件、记忆索引或历史记录。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件的相对路径，例如 "INDEX.md", "knowledge/project_A.md", "journal/2026-06-11.md"',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入或追加内容到工作区文件。用于记录重要信息、更新知识文件或保存分析结果。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件的相对路径',
          },
          content: {
            type: 'string',
            description: '要写入的内容（Markdown 格式）',
          },
          mode: {
            type: 'string',
            enum: ['overwrite', 'append'],
            description: '写入模式：overwrite 覆盖整个文件，append 追加到文件末尾',
          },
        },
        required: ['path', 'content', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出工作区中指定目录下的文件列表。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '目录的相对路径，空字符串表示根目录',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在工作区所有文件中搜索包含关键词的内容。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除工作区中的文件。仅允许删除 journal/、knowledge/、monthly/ 目录下的文件。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件的相对路径',
          },
        },
        required: ['path'],
      },
    },
  },
];
