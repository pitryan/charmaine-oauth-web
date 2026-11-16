import "@supabase/functions-js/edge-runtime.d.ts";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { pipeline } from "@supabase/middleware";

import { withOAuthProtectedResource, withSupabase } from "@supabase/server";

import { z } from "zod";

import { listMemories, listMemoriesSchema } from "./list_memories.ts";

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
            description: "Cari ingatan Charmaine berdasarkan isi cerita. " +
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
                  "canon_status,clarity",
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
              "atau kategori baku/alias sehari-hari. " +
              "Cocok untuk mengenang masa sekolah. Hanya membaca memori " +
              "yang diizinkan RLS; total mengikuti filter sebelum pagination.",
            inputSchema: listMemoriesSchema,
            annotations: { readOnlyHint: true },
          },
          (args) => listMemories(supabase, args),
        );

        return server;
      });

      return await handler.fetch(req);
    },
  ),
);
