
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  createMcpHandler,
  McpServer,
} from "npm:@modelcontextprotocol/server@^2.0.0";

import { pipeline } from "npm:@supabase/middleware@1";

import {
  withOAuthProtectedResource,
  withSupabase,
} from "npm:@supabase/server@1";

import { z } from "npm:zod@^4.3.6";

Deno.serve(
  pipeline(
    [
      withOAuthProtectedResource(),
      withSupabase({ auth: "user" }),
    ],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({
          name: "charmaine-mcp",
          version: "0.2.0",
        });

        // Tool pertama: tes koneksi
        server.registerTool(
          "ping",
          {
            description: "Tes koneksi MCP Charmaine.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          () => ({
            content: [
              {
                type: "text",
                text: "MCP Charmaine aktif!",
              },
            ],
          }),
        );

        // Tool kedua: cari ingatan Charmaine
        server.registerTool(
          "search_memories",
          {
            description:
              "Cari ingatan Charmaine berdasarkan isi cerita. " +
              "Hanya membaca memori yang diizinkan RLS. " +
              "Status draft atau canon tetap dipertahankan.",
            inputSchema: z.object({
              query: z.string().trim().min(2).max(100),
              limit: z.number().int().min(1).max(10).default(5),
            }),
            annotations: { readOnlyHint: true },
          },
          async ({ query, limit }) => {
            // Menggunakan client OAuth milik pengguna.
            // RLS tetap berlaku.
            const { data, error } = await supabase
              .from("charmaine_memories")
              .select(
                "memory_key,title,memory_text,period," +
                "school_year,event_year,category,origin," +
                "canon_status,clarity"
              )
              .ilike("memory_text", `%${query}%`)
              .order("created_at", { ascending: false })
              .limit(limit);

            if (error) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: `Pencarian gagal: ${error.message}`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    count: data?.length ?? 0,
                    memories: data ?? [],
                  }),
                },
              ],
            };
          },
        );


server.registerTool(
  "list_memories",
  {
    description:
      "Ambil daftar ingatan Charmaine berdasarkan tahun ajaran " +
      "atau kategori. Cocok untuk mengenang masa sekolah.",
    inputSchema: z.object({
      school_year: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(10),
      offset: z.number().int().min(0).default(0),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ school_year, category, limit, offset }) => {
    let query = supabase
      .from("charmaine_memories")
      .select(
        "memory_key,title,memory_text,school_year," +
        "category,canon_status,clarity",
        { count: "exact" }
      )
      .order("memory_key", { ascending: true })
      .range(offset, offset + limit - 1);

    if (school_year) {
      query = query.eq("school_year", school_year);
    }

    if (category) {
      query = query.eq("category", category);
    }

    const { data, error, count } = await query;

    if (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Gagal mengambil memori: ${error.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: data?.length ?? 0,
            total: count ?? 0,
            offset,
            memories: data ?? [],
          }),
        },
      ],
    };
  }
);


        return server;
      });

      return handler.fetch(req);
    },
  ),
);
