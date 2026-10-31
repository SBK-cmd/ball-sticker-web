<?xml version="1.0"?>
<!-- Sign Tools for CorelDRAW: ปุ่มเปิดแผง + Docker ที่มีหน้าแผง (WPF + WebView2) -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:frmwrk="Corel Framework Data">
  <xsl:output method="xml" encoding="UTF-8" indent="yes"/>
  <frmwrk:uiconfig>
    <frmwrk:applicationInfo userConfiguration="true" />
  </frmwrk:uiconfig>
  <xsl:template match="node()|@*">
    <xsl:copy><xsl:apply-templates select="node()|@*"/></xsl:copy>
  </xsl:template>
  <xsl:template match="uiConfig/items">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
      <itemData guid="3c66267b-c422-41ce-bb34-9b5eb5ab584d" noBmpOnMenu="true"
                type="checkButton"
                check="*Docker('777a605d-6e7d-4ff9-8cc3-aea47909a423')"
                dynamicCategory="2cc24a3e-fe24-4708-9a74-9c75406eebcd"
                userCaption="Sign Tools"
                enable="true"/>
      <itemData guid="4900ebfc-989f-4393-99b5-620607e9a471"
                type="wpfhost"
                hostedType="Addons\SignTools\SignToolsCorel.dll,SignToolsCorel.DockerUI"
                enable="true"/>
    </xsl:copy>
  </xsl:template>
  <xsl:template match="uiConfig/dockers">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
      <dockerData guid="777a605d-6e7d-4ff9-8cc3-aea47909a423" userCaption="Sign Tools" wantReturn="true" focusStyle="noThrow">
        <container>
          <item dock="fill" margin="0,0,0,0" guidRef="4900ebfc-989f-4393-99b5-620607e9a471"/>
        </container>
      </dockerData>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>
