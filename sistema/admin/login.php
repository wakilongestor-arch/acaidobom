<?php
declare(strict_types=1);
session_start();
if(!empty($_SESSION['acai_admin'])){header('Location:index.php');exit;}
$error=''; $hash=getenv('ADMIN_PASSWORD_HASH'); $plain=getenv('ADMIN_PASSWORD');
if($_SERVER['REQUEST_METHOD']==='POST'){
  $password=(string)($_POST['password']??'');
  if(($hash&&password_verify($password,$hash))||($plain&&hash_equals($plain,$password))){session_regenerate_id(true);$_SESSION['acai_admin']=true;header('Location:index.php');exit;}
  $error='Senha inválida.';
}
?><!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entrar | Açaí do Bom</title><link rel="stylesheet" href="admin.css"></head><body class="login-page"><main class="login-card"><a class="login-brand" href="../../"><span>A</span><div><b>Açaí do Bom</b><small>PAINEL DE GESTÃO</small></div></a><h1>Acesse sua operação</h1><p>Entre com a senha administrativa configurada na hospedagem.</p><?php if(!$hash&&!$plain):?><div class="setup-warning"><b>Configuração necessária</b><span>Defina <code>ADMIN_PASSWORD</code> ou <code>ADMIN_PASSWORD_HASH</code> no servidor antes do primeiro acesso.</span></div><?php else:?><form method="post"><label>Senha administrativa<input type="password" name="password" required autocomplete="current-password"></label><?php if($error):?><p class="login-error"><?=htmlspecialchars($error)?></p><?php endif;?><button>Entrar no painel</button></form><?php endif;?><a class="back-link" href="../../">← Voltar ao cardápio</a></main></body></html>