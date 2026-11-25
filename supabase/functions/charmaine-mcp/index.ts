import "@supabase/functions-js/edge-runtime.d.ts";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { pipeline } from "@supabase/middleware";

import { withOAuthProtectedResource, withSupabase } from "@supabase/server";

import { z } from "zod";

import { correctMemory, correctMemorySchema } from "./correct_memory.ts";
import { createMemory, createMemorySchema } from "./create_memory.ts";
import { deleteMemory, deleteMemorySchema } from "./delete_memory.ts";
import { listMemories, listMemoriesSchema } from "./list_memories.ts";
import { promoteMemory, promoteMemorySchema } from "./promote_memory.ts";
import { searchMemories, searchMemoriesSchema } from "./search_memories.ts";

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
          version: "0.5.0",
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
              "Cari ingatan Charmaine berdasarkan judul atau isi cerita. " +
              "Hanya membaca memori yang diizinkan RLS. " +
              "Bisa dibatasi ke draft atau canon; status selalu dipertahankan.",
            inputSchema: searchMemoriesSchema,
            annotations: { readOnlyHint: true },
          },
          (args) => searchMemories(supabase, args),
        );

        server.registerTool(
          "list_memories",
          {
            description: "Ambil daftar ingatan Charmaine berdasarkan status, " +
              "periode hidup, tahun kejadian, kategori, atau tahun ajaran. " +
              "Hanya membaca memori yang diizinkan RLS; total mengikuti " +
              "filter sebelum pagination.",
            inputSchema: listMemoriesSchema,
            annotations: { readOnlyHint: true },
          },
          (args) => listMemories(supabase, args),
        );

        server.registerTool(
          "create_memory",
          {
            description: "Simpan ingatan autobiografis baru sebagai draft. " +
              "Memori baru hanya berupa event, fact, atau state; rencana dan " +
              "daftar tugas tidak disimpan sebagai memori jangka panjang. " +
              "Fakta dasar, mode kontinuitas, dan ketepatan waktu wajib " +
              "dibedakan dari narasi subjektif Syzeline. " +
              "Tool ini tidak dapat menentukan owner atau membuat canon.",
            inputSchema: createMemorySchema,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          (args) => createMemory(supabase, args),
        );

        server.registerTool(
          "promote_memory",
          {
            description:
              "Jadikan memori draft sebagai canon setelah pengguna " +
              "mengonfirmasi bahwa event, fact, atau state tersebut benar. " +
              "Target harus menyertakan memory_key, judul yang diharapkan, " +
              "dan konfirmasi persis JADIKAN CANON. " +
              "Promosi tidak dapat menambah atau mengubah waktu kejadian. " +
              "Draft plan lama tidak dapat dipromosikan. Hanya memori milik " +
              "sesi OAuth yang dapat dipromosikan.",
            inputSchema: promoteMemorySchema,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
            },
          },
          (args) => promoteMemory(supabase, args),
        );

        server.registerTool(
          "correct_memory",
          {
            description: "Koreksi isi memori milik pengguna secara permanen " +
              "setelah target dan judulnya dikonfirmasi. Isi lama tidak " +
              "disimpan sebagai revisi. Memori hasil koreksi selalu kembali " +
              "menjadi draft agar dapat diperiksa sebelum dijadikan canon. " +
              "Koreksi waktu mengganti seluruh kelompok jangkar waktu agar " +
              "tidak menyisakan tanggal yang saling bertentangan.",
            inputSchema: correctMemorySchema,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
            },
          },
          (args) => correctMemory(supabase, args),
        );

        server.registerTool(
          "delete_memory",
          {
            description: "Hapus satu memori milik pengguna secara permanen. " +
              "Tidak ada arsip, tombstone, atau salinan isi di tingkat " +
              "aplikasi. Gunakan hanya setelah pengguna mengonfirmasi " +
              "memory_key dan judul target secara eksplisit.",
            inputSchema: deleteMemorySchema,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
            },
          },
          (args) => deleteMemory(supabase, args),
        );

        return server;
      });

      return await handler.fetch(req);
    },
  ),
);
